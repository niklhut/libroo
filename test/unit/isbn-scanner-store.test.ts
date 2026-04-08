import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useIsbnScannerStore } from '../../app/stores/isbnScanner'
import { useLibraryDashboardStore } from '../../app/stores/libraryDashboard'

interface ToastPayload {
  title: string
  description?: string
  color?: string
}

describe('useIsbnScannerStore', () => {
  const toastAdd = vi.fn<(payload: ToastPayload) => void>()

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
    toastAdd.mockReset()

    ;(globalThis as unknown as { useToast: () => { add: typeof toastAdd } }).useToast = () => ({
      add: toastAdd
    })
  })

  it('warns and skips duplicate ISBN entries', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ found: true, isbn: '9781234567890', title: 'Book A', author: 'Author A' })

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    await store.addIsbn('9781234567890')
    await store.addIsbn('9781234567890')

    expect(store.scannedBooks).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Already scanned',
      color: 'warning'
    }))
  })

  it('marks existing local books as already owned and deselected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        found: true,
        isbn: '9781234567890',
        title: 'Book A',
        author: 'Author A',
        existsLocally: true
      })

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    await store.addIsbn('9781234567890')

    expect(store.scannedBooks).toHaveLength(1)
    expect(store.scannedBooks[0]?.status).toBe('already_owned')
    expect(store.scannedBooks[0]?.selected).toBe(false)
  })

  it('bulk-add success removes scanned books and marks dashboard sync', async () => {
    const lookupIsbn = '9781234567890'
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/books/lookup') {
        return {
          found: true,
          isbn: lookupIsbn,
          title: 'Book A',
          author: 'Author A'
        }
      }

      if (url === '/api/books/bulk-add') {
        return {
          added: [{ isbn: lookupIsbn }],
          failed: []
        }
      }

      throw new Error(`Unexpected URL ${url}`)
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
      addedAt: new Date().toISOString()
    }))

    const scannerStore = useIsbnScannerStore()
    await scannerStore.addIsbn(lookupIsbn)

    const result = await scannerStore.addSelectedToLibrary()

    expect(result).toEqual({ success: [lookupIsbn], failed: [] })
    expect(scannerStore.scannedBooks).toEqual([])
    expect(dashboardStore.shouldSync).toBe(true)
    expect(dashboardStore.syncTargetPages).toBe(2)
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Books added!',
      color: 'success'
    }))
  })
})
