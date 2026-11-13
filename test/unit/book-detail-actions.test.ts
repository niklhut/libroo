import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { useBookDetailActions } from '../../app/composables/useBookDetailActions'
import { useLibraryDashboardStore } from '../../app/stores/libraryDashboard'
import type { BookDetails, LibraryBook } from '../../shared/types/book'

describe('book detail deletion', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
    vi.stubGlobal('useLibraryDashboardStore', useLibraryDashboardStore)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('removes a successful deletion from dashboard state before navigation', async () => {
    const store = useLibraryDashboardStore()
    const book = { id: 'deleted', bookId: 'canonical', title: 'Deleted book', libraryState: 'owned', author: 'Author', isbn: null, coverPath: null, addedAt: new Date() } satisfies LibraryBook
    store.addBook(book)
    store.pagination = { page: 1, pageSize: 12, totalItems: 1, totalPages: 1, hasMore: false }
    store.cacheResults('library')
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}))
    const navigate = vi.fn(async () => {
      expect(store.allBooks).toEqual([])
      expect(store.pendingAddedBooks).toEqual([])
      expect(store.resultCache).toEqual({})
      expect(store.shouldSync).toBe(true)
    })
    vi.stubGlobal('navigateTo', navigate)

    const actions = useBookDetailActions('deleted', ref(null), vi.fn())
    await expect(actions.removeBook()).resolves.toBe('removed')
    expect(navigate).toHaveBeenCalledWith('/library')
    expect(store.pagination.totalItems).toBe(0)
  })

  it.each([500, 409])('keeps dashboard state when deletion fails with %s', async (statusCode) => {
    const store = useLibraryDashboardStore()
    const book = { id: 'kept' } as LibraryBook
    store.allBooks = [book]
    vi.stubGlobal('$fetch', vi.fn().mockRejectedValue({ statusCode }))
    const navigate = vi.fn()
    vi.stubGlobal('navigateTo', navigate)
    const actions = useBookDetailActions('kept', ref({ activeLoan: {} } as BookDetails), vi.fn())

    await expect(actions.removeBook()).resolves.toBe(statusCode === 409 ? 'active-loan' : 'failed')
    expect(store.allBooks).toEqual([book])
    expect(store.shouldSync).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })
})
