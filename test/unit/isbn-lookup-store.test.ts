import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useIsbnLookupStore } from '../../app/stores/isbnLookup'
import { useLibraryDashboardStore } from '../../app/stores/libraryDashboard'

const _orig$fetch = (globalThis as { $fetch?: unknown }).$fetch

describe('useIsbnLookupStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()

    if (typeof _orig$fetch === 'undefined') {
      delete (globalThis as { $fetch?: unknown }).$fetch
    } else {
      ;(globalThis as { $fetch?: unknown }).$fetch = _orig$fetch
    }
  })

  it('looks up an ISBN through the shared lookup endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      found: true,
      isbn: '9781234567890',
      title: 'Book A',
      author: 'Author A'
    })

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnLookupStore()
    const result = await store.lookupIsbn('9781234567890')

    expect(result).toEqual({
      ok: true,
      result: {
        found: true,
        isbn: '9781234567890',
        title: 'Book A',
        author: 'Author A'
      }
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/books/lookup', {
      method: 'POST',
      body: { isbn: '9781234567890' }
    })
  })

  it('adds a typed single ISBN through the shared bulk add primitive and marks dashboard sync', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      added: [{ isbn: '9781234567890' }],
      failed: []
    })

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const dashboardStore = useLibraryDashboardStore()
    dashboardStore.pageSize = 12
    dashboardStore.allBooks = Array.from({ length: 24 }, (_, index) => ({
      id: `id-${index + 1}`,
      bookId: `book-${index + 1}`,
      title: `Title ${index + 1}`,
      author: `Author ${index + 1}`,
      isbn: `isbn-${index + 1}`,
      coverPath: null,
      location: null,
      addedAt: new Date().toISOString()
    }))

    const store = useIsbnLookupStore()
    const result = await store.addIsbnsToLibrary(['9781234567890'])

    expect(result).toEqual({
      success: ['9781234567890'],
      failed: [],
      failedIsbns: []
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/books/bulk-add', {
      method: 'POST',
      body: { books: [{ isbn: '9781234567890', libraryState: 'owned' }] }
    })
    expect(dashboardStore.shouldSync).toBe(true)
    expect(dashboardStore.syncTargetPages).toBe(2)
  })

  it('normalizes bulk add failures for scanner and bulk flows', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      added: [{ isbn: '9781234567890' }],
      failed: [{ isbn: '9780987654321', error: 'BookCreateError' }]
    })

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnLookupStore()
    const result = await store.addIsbnsToLibrary(['9781234567890', '9780987654321'])

    expect(result).toEqual({
      success: ['9781234567890'],
      failed: [{ isbn: '9780987654321', error: 'BookCreateError' }],
      failedIsbns: ['9780987654321']
    })
  })
})
