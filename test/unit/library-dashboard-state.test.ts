import { beforeEach, describe, expect, it } from 'vitest'
import { useLibraryDashboardState } from '../../app/composables/useLibraryDashboardState'
import type { LibraryBook } from '../../shared/types/book'

type Box<T> = { value: T }

const createBook = (id: string): LibraryBook => ({
  id,
  bookId: `book-${id}`,
  title: `Title ${id}`,
  author: `Author ${id}`,
  isbn: `97800000000${id}`,
  coverPath: null,
  addedAt: new Date().toISOString()
})

describe('useLibraryDashboardState', () => {
  let stateMap: Map<string, Box<unknown>>
  let createStore: () => ReturnType<typeof useLibraryDashboardState>

  beforeEach(() => {
    stateMap = new Map<string, Box<unknown>>()

    ;(globalThis as unknown as {
      useState: <T>(key: string, init: () => T) => Box<T>
    }).useState = <T>(key: string, init: () => T): Box<T> => {
      if (!stateMap.has(key)) {
        stateMap.set(key, { value: init() })
      }
      return stateMap.get(key) as Box<T>
    }

    createStore = () => useLibraryDashboardState() as ReturnType<typeof useLibraryDashboardState>
  })

  it('initializes with expected defaults', () => {
    const store = createStore()

    expect(store.page.value).toBe(1)
    expect(store.pageSize.value).toBe(12)
    expect(store.allBooks.value).toEqual([])
    expect(store.pagination.value).toBeNull()
    expect(store.shouldRestoreScroll.value).toBe(false)
    expect(store.shouldSync.value).toBe(false)
    expect(store.syncTargetPages.value).toBe(1)
  })

  it('computes loaded pages from current books and page size', () => {
    const store = createStore()

    store.pageSize.value = 12
    store.allBooks.value = Array.from({ length: 25 }, (_: unknown, i: number) => createBook(String(i + 1)))

    expect(store.getLoadedPages()).toBe(3)
  })

  it('adds a new book to front and updates pagination totals', () => {
    const store = createStore()

    store.page.value = 1
    store.allBooks.value = [createBook('1'), createBook('2')]
    store.pagination.value = {
      page: 1,
      pageSize: 12,
      totalItems: 2,
      totalPages: 1,
      hasMore: false
    }

    store.addBook(createBook('3'))

    expect(store.allBooks.value.map((b: LibraryBook) => b.id)).toEqual(['3', '1', '2'])
    expect(store.pagination.value).toEqual({
      page: 1,
      pageSize: 12,
      totalItems: 3,
      totalPages: 1,
      hasMore: false
    })
  })

  it('reorders an existing book without increasing totals', () => {
    const store = createStore()

    store.page.value = 1
    store.allBooks.value = [createBook('1'), createBook('2')]
    store.pagination.value = {
      page: 1,
      pageSize: 12,
      totalItems: 2,
      totalPages: 1,
      hasMore: false
    }

    store.addBook({ ...createBook('2'), title: 'Updated Title' })

    expect(store.allBooks.value.map((b: LibraryBook) => b.id)).toEqual(['2', '1'])
    expect(store.allBooks.value[0]?.title).toBe('Updated Title')
    expect(store.pagination.value?.totalItems).toBe(2)
  })

  it('removes books, updates pagination, and clamps page', () => {
    const store = createStore()

    store.page.value = 2
    store.pageSize.value = 12
    store.allBooks.value = [createBook('1'), createBook('2'), createBook('3')]
    store.pagination.value = {
      page: 2,
      pageSize: 12,
      totalItems: 13,
      totalPages: 2,
      hasMore: false
    }

    store.removeBooks(['3'])

    expect(store.allBooks.value.map((b: LibraryBook) => b.id)).toEqual(['1', '2'])
    expect(store.page.value).toBe(1)
    expect(store.pagination.value).toEqual({
      page: 2,
      pageSize: 12,
      totalItems: 12,
      totalPages: 1,
      hasMore: false
    })
  })

  it('marks sync with loaded page target and can clear it', () => {
    const store = createStore()

    store.pageSize.value = 12
    store.allBooks.value = Array.from({ length: 18 }, (_: unknown, i: number) => createBook(String(i + 1)))

    store.markNeedsSync()
    expect(store.shouldSync.value).toBe(true)
    expect(store.syncTargetPages.value).toBe(2)

    store.markNeedsSync(0)
    expect(store.syncTargetPages.value).toBe(1)

    store.clearNeedsSync()
    expect(store.shouldSync.value).toBe(false)
    expect(store.syncTargetPages.value).toBe(1)
  })
})
