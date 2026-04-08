import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { useLibraryDashboardStore } from '../../app/stores/libraryDashboard'
import type { LibraryBook } from '../../shared/types/book'

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
      shouldRestoreScroll,
      shouldSync,
      syncTargetPages
    } = storeToRefs(store)

    expect(page.value).toBe(1)
    expect(pageSize.value).toBe(12)
    expect(allBooks.value).toEqual([])
    expect(pagination.value).toBeNull()
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
})
