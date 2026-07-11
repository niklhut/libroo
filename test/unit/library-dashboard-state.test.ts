import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { MAX_DASHBOARD_RESULT_CACHE_ENTRIES, useLibraryDashboardStore } from '../../app/stores/libraryDashboard'
import type { LibraryBook } from '../../shared/types/book'
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

    createStore = () => useLibraryDashboardStore()
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
