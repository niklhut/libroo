import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { MAX_DASHBOARD_RESULT_CACHE_ENTRIES, useLibraryDashboardStore } from '../../app/stores/libraryDashboard'
import type { LibraryBook, LibraryBookEnrichmentUpdate } from '../../shared/types/book'
import { DEFAULT_LIBRARY_STATE_FILTER } from '../../shared/utils/library-query'

const createBook = (id: string): LibraryBook => ({
  id,
  bookId: `book-${id}`,
  libraryState: 'owned',
  title: `Title ${id}`,
  author: `Author ${id}`,
  isbn: `97800000000${id}`,
  coverPath: null,
  addedAt: new Date().toISOString()
})

describe('useLibraryDashboardStore', () => {
  let createStore: () => ReturnType<typeof useLibraryDashboardStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()

    createStore = () => useLibraryDashboardStore()
  })

  it('starts enrichment with an immediate foreground request for the batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ claimed: 0, pending: 0, nextAttemptAt: null })
    vi.stubGlobal('$fetch', fetchMock)
    const store = createStore()

    store.startEnrichmentBatch('batch-immediate')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(fetchMock).toHaveBeenCalledWith('/api/books/enrichment/batch', expect.objectContaining({
      method: 'POST',
      body: { batchId: 'batch-immediate' }
    }))
  })

  it('continues through multiple foreground passes while work remains pending', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ claimed: 1, pending: 2, nextAttemptAt: null })
      .mockResolvedValueOnce({ claimed: 0, pending: 1, nextAttemptAt: null })
      .mockResolvedValueOnce({ claimed: 1, pending: 0, nextAttemptAt: null })
    vi.stubGlobal('$fetch', fetchMock)
    const store = createStore()

    store.startEnrichmentBatch('batch-multi-pass')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await vi.advanceTimersByTimeAsync(5_000)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    expect(fetchMock).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('keeps imported books pending when a foreground enrichment request fails', async () => {
    const book = { ...createBook('imported'), enrichmentStatus: 'queued' as const }
    const fetchMock = vi.fn().mockRejectedValue(new Error('temporary failure'))
    vi.stubGlobal('$fetch', fetchMock)
    const store = createStore()
    store.allBooks = [book]

    store.startEnrichmentBatch('batch-failure')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(store.allBooks[0]?.enrichmentStatus).toBe('queued')
    store.resetAll()
  })

  it('does not let a late response from a reset batch restart foreground work', async () => {
    let resolveResponse: ((value: unknown) => void) | undefined
    const response = new Promise((resolve) => {
      resolveResponse = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(response)
    vi.stubGlobal('$fetch', fetchMock)
    const store = createStore()

    store.startEnrichmentBatch('batch-reset')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    store.resetAll()
    resolveResponse?.({ claimed: 1, pending: 1, nextAttemptAt: null })
    await Promise.resolve()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('runs different batches concurrently but deduplicates the same batch', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ claimed: 1, pending: 1, nextAttemptAt: null })
      .mockResolvedValueOnce({ claimed: 1, pending: 1, nextAttemptAt: null })
      .mockResolvedValue({ claimed: 0, pending: 0, nextAttemptAt: null })
    vi.stubGlobal('$fetch', fetchMock)
    const store = createStore()

    store.startEnrichmentBatch('batch-a')
    store.startEnrichmentBatch('batch-b')
    store.startEnrichmentBatch('batch-a')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

    expect(fetchMock.mock.calls.map(call => call[1]?.body)).toEqual([
      { batchId: 'batch-a' },
      { batchId: 'batch-b' },
      { batchId: 'batch-a' },
      { batchId: 'batch-b' }
    ])
    vi.useRealTimers()
  })

  it('ignores a late response when the same batch ID is restarted after reset', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined
    let resolveSecond: ((value: unknown) => void) | undefined
    const first = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise((resolve) => {
      resolveSecond = resolve
    })
    const fetchMock = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
    vi.stubGlobal('$fetch', fetchMock)
    const store = createStore()

    store.startEnrichmentBatch('batch-restart')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    store.resetAll()
    store.startEnrichmentBatch('batch-restart')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    resolveFirst?.({ claimed: 1, pending: 1, nextAttemptAt: null })
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    resolveSecond?.({ claimed: 0, pending: 0, nextAttemptAt: null })
    await Promise.resolve()
  })

  it('keeps buffered enrichment tags aligned with later manual tag edits', () => {
    const store = createStore()
    store.updateBookEnrichment('1', {
      userBookId: '1', bookId: 'book-1', isbn: '978000000001', author: 'Author', authors: ['Author'],
      coverPath: null, coverUrl: null, subjects: [], tags: ['old'], suggestedTags: ['new', 'keep'], status: 'no_cover'
    })
    store.updateBookTags('1', ['new'])
    store.allBooks = [createBook('1')]
    store.applyPendingEnrichmentUpdates()
    expect(store.allBooks[0]?.tags).toEqual(['new'])
    expect(store.allBooks[0]?.suggestedTags).toEqual(['keep'])
  })

  it('keeps pending book tags aligned after results reset and rehydration', () => {
    const store = createStore()
    const book = { ...createBook('pending'), tags: ['old'] }
    store.addBook(book)
    store.resetResults()

    store.updateBookTags('pending', ['new'])
    store.updateBookEnrichment('pending', {
      userBookId: 'pending', bookId: 'book-pending', isbn: '97800000000pending', author: 'Author', authors: ['Author'],
      coverPath: null, coverUrl: null, subjects: [], tags: ['old'], suggestedTags: ['new', 'keep'], status: 'no_cover'
    })
    store.allBooks = [...store.pendingAddedBooks]
    store.applyPendingEnrichmentUpdates()

    expect(store.allBooks[0]?.tags).toEqual(['new'])
    expect(store.allBooks[0]?.suggestedTags).toEqual(['keep'])
  })

  it('preserves a tag edit when an enrichment response arrives afterward', async () => {
    let resolveResponse: ((value: unknown) => void) | undefined
    const response = new Promise((resolve) => {
      resolveResponse = resolve
    })
    const fetchMock = vi.fn().mockReturnValue(response)
    vi.stubGlobal('$fetch', fetchMock)
    const store = createStore()
    store.allBooks = [{ ...createBook('1'), tags: ['old'] }]

    store.startEnrichmentBatch('batch-late-tags')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    store.updateBookTags('1', ['new'])
    resolveResponse?.({
      claimed: 1,
      pending: 0,
      nextAttemptAt: null,
      updates: [{
        userBookId: '1',
        bookId: 'book-1',
        isbn: '978000000001',
        author: 'Author',
        authors: ['Author'],
        coverPath: null,
        coverUrl: null,
        subjects: [],
        tags: ['old'],
        suggestedTags: ['new', 'keep'],
        status: 'no_cover'
      } satisfies LibraryBookEnrichmentUpdate]
    })
    await vi.waitFor(() => expect(store.allBooks[0]?.enrichmentStatus).toBe('no_cover'))

    expect(store.allBooks[0]?.tags).toEqual(['new'])
    expect(store.allBooks[0]?.suggestedTags).toEqual(['keep'])
    store.resetAll()
  })

  it('initializes with expected defaults', () => {
    const store = createStore()
    const {
      page,
      pageSize,
      allBooks,
      pagination,
      libraryState,
      shouldRestoreScroll,
      shouldSync,
      syncTargetPages
    } = storeToRefs(store)

    expect(page.value).toBe(1)
    expect(pageSize.value).toBe(12)
    expect(allBooks.value).toEqual([])
    expect(pagination.value).toBeNull()
    expect(libraryState.value).toEqual(DEFAULT_LIBRARY_STATE_FILTER)
    expect(shouldRestoreScroll.value).toBe(false)
    expect(shouldSync.value).toBe(false)
    expect(syncTargetPages.value).toBe(1)
  })

  it('computes loaded pages from current books and page size', () => {
    const store = createStore()
    const { pageSize, allBooks } = storeToRefs(store)

    pageSize.value = 12
    allBooks.value = Array.from({ length: 25 }, (_: unknown, i: number) => createBook(String(i + 1)))

    expect(store.getLoadedPages()).toBe(3)
  })

  it('adds a new book to front and updates pagination totals', () => {
    const store = createStore()
    const { page, allBooks, pagination } = storeToRefs(store)

    page.value = 1
    allBooks.value = [createBook('1'), createBook('2')]
    pagination.value = {
      page: 1,
      pageSize: 12,
      totalItems: 2,
      totalPages: 1,
      hasMore: false
    }

    store.addBook(createBook('3'))

    expect(allBooks.value.map((b: LibraryBook) => b.id)).toEqual(['3', '1', '2'])
    expect(pagination.value).toEqual({
      page: 1,
      pageSize: 12,
      totalItems: 3,
      totalPages: 1,
      hasMore: false
    })
  })

  it('only inserts added books that match the selected library states', () => {
    const store = createStore()
    const { allBooks, libraryState } = storeToRefs(store)

    libraryState.value = ['wishlisted', 'previously_owned']

    store.addBook(createBook('1'))
    store.addBook({ ...createBook('2'), libraryState: 'wishlisted' })
    store.addBook({ ...createBook('3'), libraryState: 'previously_owned' })

    expect(allBooks.value.map((b: LibraryBook) => b.id)).toEqual(['3', '2'])
  })

  it.each([
    ['search', (store: ReturnType<typeof useLibraryDashboardStore>) => { store.search = 'another title' }],
    ['tag', (store: ReturnType<typeof useLibraryDashboardStore>) => { store.tags = ['fiction'] }],
    ['loan status', (store: ReturnType<typeof useLibraryDashboardStore>) => { store.loanStatus = 'loaned' }],
    ['reading status', (store: ReturnType<typeof useLibraryDashboardStore>) => { store.readingStatus = 'reading' }],
    ['location', (store: ReturnType<typeof useLibraryDashboardStore>) => { store.location = 'office' }],
    ['location descendants', (store: ReturnType<typeof useLibraryDashboardStore>) => {
      store.locationId = 'location-1'
      store.includeLocationDescendants = true
    }],
    ['sort', (store: ReturnType<typeof useLibraryDashboardStore>) => { store.sortBy = 'title' }],
    ['page', (store: ReturnType<typeof useLibraryDashboardStore>) => { store.page = 2 }]
  ])('records additions without inserting into a retained %s view', (_label, configure) => {
    const store = createStore()
    const retainedBook = createBook('retained')
    const addedBook = createBook('added')
    store.allBooks = [retainedBook]
    configure(store)

    store.addBook(addedBook)

    expect(store.allBooks).toEqual([retainedBook])
    expect(store.getPendingAddedBooks()).toEqual([addedBook])
  })

  it('reorders an existing book without increasing totals', () => {
    const store = createStore()
    const { page, allBooks, pagination } = storeToRefs(store)

    page.value = 1
    allBooks.value = [createBook('1'), createBook('2')]
    pagination.value = {
      page: 1,
      pageSize: 12,
      totalItems: 2,
      totalPages: 1,
      hasMore: false
    }

    store.addBook({ ...createBook('2'), title: 'Updated Title' })

    expect(allBooks.value.map((b: LibraryBook) => b.id)).toEqual(['2', '1'])
    expect(allBooks.value[0]?.title).toBe('Updated Title')
    expect(pagination.value?.totalItems).toBe(2)
  })

  it('updates tags in the displayed books and cached results', () => {
    const store = createStore()
    const { allBooks, pagination } = storeToRefs(store)
    const book = { ...createBook('1'), tags: ['Old tag'] }
    allBooks.value = [book]
    pagination.value = { page: 1, pageSize: 12, totalItems: 1, totalPages: 1, hasMore: false }
    store.cacheResults('library')

    store.updateBookTags('1', ['New tag'])

    expect(allBooks.value[0]?.tags).toEqual(['New tag'])
    allBooks.value = []
    store.restoreCachedResults('library')
    expect(allBooks.value[0]?.tags).toEqual(['New tag'])
  })

  it('applies rich enrichment updates to displayed and cached books', () => {
    const store = createStore()
    const { allBooks, pagination } = storeToRefs(store)
    allBooks.value = [{ ...createBook('1'), enrichmentStatus: 'preparing', tags: ['manual'] }]
    pagination.value = { page: 1, pageSize: 12, totalItems: 1, totalPages: 1, hasMore: false }
    store.cacheResults('library')

    const update: LibraryBookEnrichmentUpdate = {
      userBookId: '1',
      bookId: 'book-1',
      isbn: '978000000001',
      author: 'Updated Author',
      authors: ['Updated Author'],
      coverPath: 'covers/updated.webp',
      coverUrl: null,
      description: 'Updated description',
      publishDate: '2024',
      publishers: ['Publisher A', 'Publisher B'],
      numberOfPages: 321,
      openLibraryKey: 'OL1W',
      workKey: 'OL1W',
      subjects: ['fiction'],
      tags: ['fiction', 'manual'],
      suggestedTags: ['suggested'],
      status: 'no_cover'
    }

    store.updateBookEnrichment('1', update)

    expect(allBooks.value[0]).toMatchObject({
      author: 'Updated Author',
      coverPath: 'covers/updated.webp',
      description: 'Updated description',
      publishers: 'Publisher A, Publisher B',
      numberOfPages: 321,
      tags: ['manual'],
      enrichmentStatus: 'no_cover'
    })
    allBooks.value = []
    store.restoreCachedResults('library')
    expect(store.allBooks[0]?.coverPath).toBe('covers/updated.webp')
    expect(store.allBooks[0]?.tags).toEqual(['manual'])
  })

  it('buffers enrichment updates until a matching book is hydrated', () => {
    const store = createStore()
    const update = {
      userBookId: 'late', bookId: 'book-late', isbn: '978000000009', author: 'Author', authors: ['Author'],
      coverPath: 'covers/late.webp', coverUrl: null, subjects: [], status: 'not_found' as const
    } satisfies LibraryBookEnrichmentUpdate

    store.updateBookEnrichment('late', update)
    store.allBooks = [createBook('late')]
    store.applyPendingEnrichmentUpdates()

    expect(store.allBooks[0]).toMatchObject({ coverPath: 'covers/late.webp', enrichmentStatus: 'not_found' })
  })

  it('removes books, updates pagination, and clamps page', () => {
    const store = createStore()
    const { page, pageSize, allBooks, pagination } = storeToRefs(store)

    page.value = 2
    pageSize.value = 12
    allBooks.value = [createBook('1'), createBook('2'), createBook('3')]
    pagination.value = {
      page: 2,
      pageSize: 12,
      totalItems: 13,
      totalPages: 2,
      hasMore: false
    }

    store.removeBooks(['3'])

    expect(allBooks.value.map((b: LibraryBook) => b.id)).toEqual(['1', '2'])
    expect(page.value).toBe(1)
    expect(pagination.value).toEqual({
      page: 2,
      pageSize: 12,
      totalItems: 12,
      totalPages: 1,
      hasMore: false
    })
  })

  it('marks sync with loaded page target and can clear it', () => {
    const store = createStore()
    const { pageSize, allBooks, shouldSync, syncTargetPages } = storeToRefs(store)

    pageSize.value = 12
    allBooks.value = Array.from({ length: 18 }, (_: unknown, i: number) => createBook(String(i + 1)))

    store.markNeedsSync()
    expect(shouldSync.value).toBe(true)
    expect(syncTargetPages.value).toBe(2)

    store.markNeedsSync(0)
    expect(syncTargetPages.value).toBe(1)

    store.clearNeedsSync()
    expect(shouldSync.value).toBe(false)
    expect(syncTargetPages.value).toBe(1)
  })

  it('resets paged results when query state changes', () => {
    const store = createStore()
    const { page, allBooks, pagination } = storeToRefs(store)

    page.value = 3
    allBooks.value = [createBook('1'), createBook('2')]
    pagination.value = {
      page: 3,
      pageSize: 12,
      totalItems: 26,
      totalPages: 3,
      hasMore: false
    }

    store.resetResults()

    expect(page.value).toBe(1)
    expect(allBooks.value).toEqual([])
    expect(pagination.value).toBeNull()
  })

  it('keeps pending additions across result resets until confirmed', () => {
    const store = createStore()
    const book = createBook('pending')
    store.addBook(book)
    store.resetResults()

    expect(store.getPendingAddedBooks().map(item => item.id)).toEqual(['pending'])
    store.clearPendingAddedBooks(['pending'])
    expect(store.getPendingAddedBooks()).toEqual([])
  })

  it('removes pending additions when a book is removed', () => {
    const store = createStore()
    store.addBook(createBook('pending'))
    store.removeBooks(['pending'])

    expect(store.getPendingAddedBooks()).toEqual([])
  })

  it('fully resets user-scoped dashboard state', () => {
    const store = createStore()
    const { page, pageSize, allBooks, pagination, resultCache, search, loanStatus, libraryState, readingStatus, tags, location, locationId, includeLocationDescendants, sortBy, groupByLocation, scrollY, shouldRestoreScroll, shouldSync, syncTargetPages } = storeToRefs(store)

    page.value = 3
    pageSize.value = 24
    allBooks.value = [createBook('1')]
    pagination.value = { page: 3, pageSize: 24, totalItems: 25, totalPages: 2, hasMore: false }
    resultCache.value = { stale: { books: [createBook('1')], pagination: { page: 1, pageSize: 12, totalItems: 1, totalPages: 1, hasMore: false }, loadedPage: 1 } }
    search.value = 'stale query'
    loanStatus.value = 'on_loan'
    libraryState.value = ['wishlisted']
    readingStatus.value = 'reading'
    tags.value = ['stale tag']
    location.value = 'stale location'
    locationId.value = 'location-1'
    includeLocationDescendants.value = true
    sortBy.value = 'title'
    groupByLocation.value = true
    scrollY.value = 240
    shouldRestoreScroll.value = true
    shouldSync.value = true
    syncTargetPages.value = 3

    store.resetAll()

    expect(page.value).toBe(1)
    expect(pageSize.value).toBe(12)
    expect(allBooks.value).toEqual([])
    expect(pagination.value).toBeNull()
    expect(resultCache.value).toEqual({})
    expect(search.value).toBe('')
    expect(loanStatus.value).toBe('all')
    expect(libraryState.value).toEqual(DEFAULT_LIBRARY_STATE_FILTER)
    expect(readingStatus.value).toBe('all')
    expect(tags.value).toEqual([])
    expect(location.value).toBe('')
    expect(locationId.value).toBe('')
    expect(includeLocationDescendants.value).toBe(false)
    expect(sortBy.value).toBe('dateAdded')
    expect(groupByLocation.value).toBe(false)
    expect(scrollY.value).toBe(0)
    expect(shouldRestoreScroll.value).toBe(false)
    expect(shouldSync.value).toBe(false)
    expect(syncTargetPages.value).toBe(1)
  })

  it('caches and restores query-scoped results', () => {
    const store = createStore()
    const { page, allBooks, pagination } = storeToRefs(store)

    page.value = 2
    allBooks.value = [createBook('1'), createBook('2')]
    pagination.value = {
      page: 2,
      pageSize: 12,
      totalItems: 20,
      totalPages: 2,
      hasMore: false
    }

    store.cacheResults('all-books')

    page.value = 1
    allBooks.value = [createBook('wishlist')]
    pagination.value = {
      page: 1,
      pageSize: 12,
      totalItems: 1,
      totalPages: 1,
      hasMore: false
    }

    const restored = store.restoreCachedResults('all-books')

    expect(restored?.loadedPage).toBe(2)
    expect(page.value).toBe(2)
    expect(allBooks.value.map((book: LibraryBook) => book.id)).toEqual(['1', '2'])
    expect(pagination.value).toEqual({
      page: 2,
      pageSize: 12,
      totalItems: 20,
      totalPages: 2,
      hasMore: false
    })
  })

  it('evicts the least recently accessed cached result once the cache cap is exceeded', () => {
    const store = createStore()
    const { allBooks, pagination, resultCache } = storeToRefs(store)
    pagination.value = { page: 1, pageSize: 12, totalItems: 1, totalPages: 1, hasMore: false }

    for (let index = 0; index < MAX_DASHBOARD_RESULT_CACHE_ENTRIES; index += 1) {
      allBooks.value = [createBook(String(index))]
      store.cacheResults(`key-${index}`)
    }
    store.restoreCachedResults('key-0')
    allBooks.value = [createBook('new')]
    store.cacheResults('new-key')

    expect(Object.keys(resultCache.value)).toHaveLength(MAX_DASHBOARD_RESULT_CACHE_ENTRIES)
    expect(resultCache.value['key-0']).toBeDefined()
    expect(resultCache.value['key-1']).toBeUndefined()
    expect(resultCache.value['new-key']).toBeDefined()
  })
})
