import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useIsbnLookupStore } from '../../app/stores/isbnLookup'
import { useLibraryDashboardStore } from '../../app/stores/libraryDashboard'
import { MAX_BULK_ISBN_COUNT } from '../../shared/utils/schemas'

const _orig$fetch = (globalThis as { $fetch?: unknown }).$fetch

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

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

  it('submits large selections in server-sized batches', async () => {
    const isbns = Array.from({ length: MAX_BULK_ISBN_COUNT * 2 + 5 }, (_, index) => `isbn-${index + 1}`)
    const fetchMock = vi.fn((_url: string, options: { body: { books: Array<{ isbn: string }> } }) => Promise.resolve({
      added: options.body.books,
      failed: []
    }))
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnLookupStore()
    const result = await store.addIsbnsToLibrary(isbns)

    expect(result.success).toEqual(isbns)
    expect(result.failed).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.map(([, options]) => options.body.books)).toEqual([
      isbns.slice(0, MAX_BULK_ISBN_COUNT).map(isbn => ({ isbn, libraryState: 'owned' })),
      isbns.slice(MAX_BULK_ISBN_COUNT, MAX_BULK_ISBN_COUNT * 2).map(isbn => ({ isbn, libraryState: 'owned' })),
      isbns.slice(MAX_BULK_ISBN_COUNT * 2).map(isbn => ({ isbn, libraryState: 'owned' }))
    ])
  })

  it('submits bulk lookups sequentially and remaps batch-local indexes', async () => {
    const isbns = Array.from({ length: MAX_BULK_ISBN_COUNT + 2 }, (_, index) => `isbn-${index + 1}`)
    let inFlight = 0
    let maxInFlight = 0
    const fetchMock = vi.fn(async (_url: string, options: { body: { isbns: string[] } }) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return {
        items: options.body.isbns.map((isbn, inputIndex) => ({
          inputIndex,
          input: isbn,
          normalizedIsbn: isbn,
          status: 'ok',
          result: { found: true, isbn }
        }))
      }
    })
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnLookupStore()
    const response = await store.bulkLookupIsbns(isbns)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(maxInFlight).toBe(1)
    expect(response.items.map(item => item.inputIndex)).toEqual(isbns.map((_, index) => index))
  })

  it('aborts an active bulk lookup when reset', async () => {
    let requestSignal: AbortSignal | undefined
    const response = deferred<{ items: [] }>()
    const fetchMock = vi.fn((_url: string, options: { signal: AbortSignal }) => {
      requestSignal = options.signal
      return response.promise
    })
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnLookupStore()
    const lookup = store.bulkLookupIsbns(['9780306406157'])
    store.reset()

    expect(requestSignal?.aborted).toBe(true)
    response.resolve({ items: [] })
    await expect(lookup).resolves.toEqual({ items: [] })
    expect(store.pendingLookups).toBe(0)
  })

  it('does not let a stale bulk lookup decrement a newer lookup counter', async () => {
    const staleResponse = deferred<{ items: [] }>()
    const currentResponse = deferred<{ items: [] }>()
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => staleResponse.promise)
      .mockImplementationOnce(() => currentResponse.promise)
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnLookupStore()
    const staleLookup = store.bulkLookupIsbns(['9780306406157'])
    store.reset()
    const currentLookup = store.bulkLookupIsbns(['9780141439518'])

    expect(store.pendingLookups).toBe(1)
    staleResponse.resolve({ items: [] })
    await staleLookup
    expect(store.pendingLookups).toBe(1)
    expect(store.isLookingUp).toBe(true)

    currentResponse.resolve({ items: [] })
    await currentLookup
    expect(store.pendingLookups).toBe(0)
    expect(store.isLookingUp).toBe(false)
  })

  it('resets pending state and lookup errors', () => {
    const store = useIsbnLookupStore()
    store.pendingLookups = 1
    store.pendingAdds = 2
    store.lookupError = 'lookup failed'
    store.addError = 'add failed'

    store.reset()

    expect(store.pendingLookups).toBe(0)
    expect(store.pendingAdds).toBe(0)
    expect(store.lookupError).toBeNull()
    expect(store.addError).toBeNull()
  })

  it('does not allow pending counters to become negative after reset', async () => {
    const lookupResponse = deferred<{ found: true, isbn: string, title: string, author: string }>()
    const fetchMock = vi.fn(() => lookupResponse.promise)
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnLookupStore()
    const lookup = store.lookupIsbn('9781234567890')
    store.reset()
    lookupResponse.resolve({ found: true, isbn: '9781234567890', title: 'Book A', author: 'Author A' })
    await lookup

    expect(store.pendingLookups).toBe(0)
    expect(store.isLookingUp).toBe(false)
  })

  it('marks the dashboard for sync when a stale add request already succeeded', async () => {
    const addResponse = deferred<{ added: Array<{ isbn: string }>, failed: [] }>()
    const fetchMock = vi.fn(() => addResponse.promise)
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const dashboardStore = useLibraryDashboardStore()
    const store = useIsbnLookupStore()
    const add = store.addIsbnsToLibrary(['9780306406157'])
    store.reset()
    addResponse.resolve({ added: [{ isbn: '9780306406157' }], failed: [] })

    await expect(add).resolves.toEqual({ success: [], failed: [], failedIsbns: [] })
    expect(dashboardStore.shouldSync).toBe(true)
  })
})
