import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed, nextTick, ref, watchEffect } from 'vue'
import { useIsbnScannerStore } from '../../app/stores/isbnScanner'
import { useIsbnLookupStore } from '../../app/stores/isbnLookup'
import { useLibraryDashboardStore } from '../../app/stores/libraryDashboard'
import { defaultContinuousMode } from '../../app/utils/cameraScanDefaults'
import {
  BULK_LOOKUP_CONCURRENCY,
  MAX_BULK_ISBN_COUNT,
  MAX_BULK_ISBN_INPUT_BYTES
} from '../../shared/utils/schemas'

const _origUseToast = (globalThis as { useToast?: unknown }).useToast
const _orig$fetch = (globalThis as { $fetch?: unknown }).$fetch

interface ToastPayload {
  title: string
  description?: string
  color?: string
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
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

  afterEach(() => {
    if (typeof _origUseToast === 'undefined') {
      delete (globalThis as { useToast?: unknown }).useToast
    } else {
      ;(globalThis as { useToast?: unknown }).useToast = _origUseToast
    }

    if (typeof _orig$fetch === 'undefined') {
      delete (globalThis as { $fetch?: unknown }).$fetch
    } else {
      ;(globalThis as { $fetch?: unknown }).$fetch = _orig$fetch
    }
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

  it('rejects bulk input that exceeds the byte cap', async () => {
    const fetchMock = vi.fn()
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    await expect(store.addMultipleIsbns('é'.repeat(MAX_BULK_ISBN_INPUT_BYTES))).resolves.toBe(false)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Bulk import is too large',
      color: 'warning'
    }))
  })

  it('looks up every valid ISBN beyond the server bulk-add cap', async () => {
    const validIsbns = Array.from({ length: MAX_BULK_ISBN_COUNT + 1 }, (_, index) => validIsbn13(index + 1))
    const fetchMock = vi.fn(async (_url: string, options: { body: { isbn: string } }) => ({
      found: true,
      isbn: options.body.isbn,
      title: 'Book',
      author: 'Author'
    }))
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    await store.addMultipleIsbns(validIsbns.join('\n'))

    expect(fetchMock).toHaveBeenCalledTimes(MAX_BULK_ISBN_COUNT + 1)
    expect(store.scannedBooks).toHaveLength(MAX_BULK_ISBN_COUNT + 1)
    expect(toastAdd).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Some ISBNs were skipped' }))
  })

  it('filters invalid, duplicate, and already scanned ISBNs from a bulk paste', async () => {
    const firstIsbn = '9780306406157'
    const secondIsbn = '9780141439518'
    const fetchMock = vi.fn(async (_url: string, options: { body: { isbn: string } }) => ({
      found: true,
      isbn: options.body.isbn,
      title: 'Book',
      author: 'Author'
    }))
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    await store.addIsbn(firstIsbn)
    await store.addMultipleIsbns([firstIsbn, firstIsbn, '9780306406158', 'not-an-isbn', secondIsbn].join('\n'))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(store.scannedBooks.map(book => book.isbn).sort()).toEqual([firstIsbn, secondIsbn].sort())
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'Some ISBNs were skipped' }))
  })

  it('bounds concurrent bulk lookups', async () => {
    const lookups: Array<ReturnType<typeof deferred<{ found: true, isbn: string, title: string, author: string }>>> = []
    let inFlight = 0
    let maxInFlight = 0
    const fetchMock = vi.fn((_url: string, options: { body: { isbn: string } }) => {
      const lookup = deferred<{ found: true, isbn: string, title: string, author: string }>()
      lookups.push(lookup)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      return lookup.promise.then(() => {
        inFlight -= 1
        return { found: true, isbn: options.body.isbn, title: 'Book', author: 'Author' }
      })
    })
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    const bulkLookup = store.addMultipleIsbns(Array.from({ length: BULK_LOOKUP_CONCURRENCY + 3 }, (_, index) => validIsbn13(index + 1)).join('\n'))
    await nextTick()

    expect(store.bulkLookupProgress).toEqual({
      active: true,
      total: BULK_LOOKUP_CONCURRENCY + 3,
      completed: 0,
      inProgress: BULK_LOOKUP_CONCURRENCY,
      queued: 3
    })

    while (store.isBulkLookingUp) {
      lookups.shift()?.resolve({ found: true, isbn: '', title: '', author: '' })
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    await bulkLookup

    expect(maxInFlight).toBe(BULK_LOOKUP_CONCURRENCY)
    expect(store.bulkLookupProgress).toEqual({ active: false, total: BULK_LOOKUP_CONCURRENCY + 3, completed: BULK_LOOKUP_CONCURRENCY + 3, inProgress: 0, queued: 0 })
  })

  it('does not add queued bulk ISBNs after scanner state is cleared', async () => {
    const lookups: Array<ReturnType<typeof deferred<{ found: true, isbn: string, title: string, author: string }>>> = []
    const fetchMock = vi.fn(() => {
      const lookup = deferred<{ found: true, isbn: string, title: string, author: string }>()
      lookups.push(lookup)
      return lookup.promise
    })
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    const bulkLookup = store.addMultipleIsbns(Array.from({ length: BULK_LOOKUP_CONCURRENCY + 1 }, (_, index) => validIsbn13(index + 1)).join('\n'))
    await nextTick()
    expect(fetchMock).toHaveBeenCalledTimes(BULK_LOOKUP_CONCURRENCY)

    store.clearAll()
    lookups.forEach(lookup => lookup.resolve({ found: true, isbn: '', title: '', author: '' }))
    await bulkLookup

    expect(fetchMock).toHaveBeenCalledTimes(BULK_LOOKUP_CONCURRENCY)
    expect(store.scannedBooks).toEqual([])
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

  it('uses a friendly lookup error and retries the same ISBN', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce({ data: { message: 'API error: 502 Bad Gateway' } })
      .mockResolvedValueOnce({
        found: true,
        isbn: '9781234567890',
        title: 'Book A',
        author: 'Author A'
      })

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    await store.addIsbn('9781234567890')

    expect(store.scannedBooks[0]?.status).toBe('error')
    expect(store.scannedBooks[0]?.errorMessage).toBe('We could not look up this ISBN right now. Try again in a moment.')

    await store.retryIsbn('9781234567890')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(store.scannedBooks[0]?.status).toBe('found')
    expect(store.scannedBooks[0]?.result?.title).toBe('Book A')
    expect(store.scannedBooks[0]?.errorMessage).toBeUndefined()
  })

  it('notifies computed dependents when lookup moves from loading to found', async () => {
    const lookup = deferred<{
      found: true
      isbn: string
      title: string
      author: string
    }>()
    const fetchMock = vi.fn(() => lookup.promise)

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    const status = computed(() => store.scannedBooks[0]?.status ?? 'empty')
    const observedStatuses: string[] = []
    const stop = watchEffect(() => {
      observedStatuses.push(status.value)
    })

    const addPromise = store.addIsbn('9781234567890')
    await nextTick()

    expect(observedStatuses).toContain('loading')
    expect(status.value).toBe('loading')

    lookup.resolve({
      found: true,
      isbn: '9781234567890',
      title: 'Book A',
      author: 'Author A'
    })
    await addPromise
    await nextTick()

    expect(observedStatuses).toEqual(['empty', 'loading', 'found'])
    expect(status.value).toBe('found')

    stop()
  })

  it('transitions from loading to not found with visible unselected state', async () => {
    const lookup = deferred<{
      found: false
      isbn: string
      message: string
    }>()
    const fetchMock = vi.fn(() => lookup.promise)

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    const status = computed(() => store.scannedBooks[0]?.status ?? 'empty')

    const addPromise = store.addIsbn('9781234567890')
    await nextTick()

    expect(status.value).toBe('loading')

    lookup.resolve({
      found: false,
      isbn: '9781234567890',
      message: 'No OpenLibrary match'
    })
    await addPromise
    await nextTick()

    expect(status.value).toBe('not_found')
    expect(store.scannedBooks[0]).toMatchObject({
      status: 'not_found',
      selected: false,
      result: {
        found: false,
        message: 'No OpenLibrary match'
      }
    })
    expect(store.scannedBooks[0]?.errorMessage).toBeUndefined()
  })

  it('transitions from loading to error with a friendly error message', async () => {
    const lookup = deferred<never>()
    const fetchMock = vi.fn(() => lookup.promise)

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    const status = computed(() => store.scannedBooks[0]?.status ?? 'empty')

    const addPromise = store.addIsbn('9781234567890')
    await nextTick()

    expect(status.value).toBe('loading')

    lookup.reject({ data: { message: 'API error: 502 Bad Gateway' } })
    await addPromise
    await nextTick()

    expect(status.value).toBe('error')
    expect(store.scannedBooks[0]).toMatchObject({
      status: 'error',
      selected: false,
      errorMessage: 'We could not look up this ISBN right now. Try again in a moment.'
    })
    expect(store.scannedBooks[0]?.result).toBeUndefined()
  })

  it('documents continuous camera scanning as the default mode', () => {
    const continuousMode = ref(defaultContinuousMode)
    const scannedBooks = ref([{ isbn: '9781234567890', status: 'loading' }])
    const singleScanBook = computed(() =>
      !continuousMode.value && scannedBooks.value.length === 1
        ? scannedBooks.value[0]
        : null
    )
    const showsBulkScanReview = computed(() => continuousMode.value && scannedBooks.value.length > 0)

    expect(defaultContinuousMode).toBe(true)
    expect(singleScanBook.value).toBeNull()
    expect(showsBulkScanReview.value).toBe(true)
  })

  it('clears scanner state and cascades to lookup state', () => {
    const scannerStore = useIsbnScannerStore()
    const lookupStore = useIsbnLookupStore()
    scannerStore.scannedBooks = [{ isbn: '9781234567890', status: 'found', selected: true }]
    scannerStore.targetLibraryState = 'wishlisted'
    scannerStore.isBulkLookingUp = true
    lookupStore.pendingLookups = 1
    lookupStore.pendingAdds = 1
    lookupStore.lookupError = 'lookup failed'
    lookupStore.addError = 'add failed'

    scannerStore.clearAll()

    expect(scannerStore.scannedBooks).toEqual([])
    expect(scannerStore.targetLibraryState).toBe('owned')
    expect(scannerStore.isBulkLookingUp).toBe(false)
    expect(lookupStore.pendingLookups).toBe(0)
    expect(lookupStore.pendingAdds).toBe(0)
    expect(lookupStore.lookupError).toBeNull()
    expect(lookupStore.addError).toBeNull()
  })

  it('ignores bulk-add results that complete after scanner state is cleared', async () => {
    const bulkAddResponse = deferred<{ added: Array<{ isbn: string }>, failed: Array<{ isbn: string, error: string }> }>()
    const fetchMock = vi.fn(() => bulkAddResponse.promise)
    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const store = useIsbnScannerStore()
    store.scannedBooks = [{ isbn: '9781234567890', status: 'found', selected: true }]
    const addPromise = store.addSelectedToLibrary()
    await nextTick()

    store.clearAll()
    store.scannedBooks = [{ isbn: '9781234567890', status: 'found', selected: true }]
    bulkAddResponse.resolve({ added: [{ isbn: '9781234567890' }], failed: [] })

    await expect(addPromise).resolves.toEqual({ success: [], failed: [] })
    expect(store.scannedBooks).toEqual([{ isbn: '9781234567890', status: 'found', selected: true }])
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
    expect(fetchMock).toHaveBeenCalledWith('/api/books/bulk-add', {
      method: 'POST',
      body: {
        books: [{ isbn: lookupIsbn, libraryState: 'owned' }]
      }
    })
    expect(scannerStore.scannedBooks).toEqual([])
    expect(dashboardStore.shouldSync).toBe(true)
    expect(dashboardStore.syncTargetPages).toBe(2)
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Book added!',
      color: 'success'
    }))
  })

  it('keeps failed add books selected so they can be retried', async () => {
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
          added: [],
          failed: [{ isbn: lookupIsbn, error: 'BookCreateError' }]
        }
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const scannerStore = useIsbnScannerStore()
    await scannerStore.addIsbn(lookupIsbn)

    const result = await scannerStore.addSelectedToLibrary()

    expect(result).toEqual({ success: [], failed: [lookupIsbn] })
    expect(scannerStore.scannedBooks[0]).toMatchObject({
      isbn: lookupIsbn,
      status: 'found',
      selected: true,
      errorMessage: 'Could not add this book to your library. Try again in a moment.'
    })
    expect(scannerStore.counts.selected).toBe(1)
  })

  it('marks already-owned add failures as not selectable', async () => {
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
          added: [],
          failed: [{ isbn: lookupIsbn, error: 'BookAlreadyOwnedError' }]
        }
      }

      throw new Error(`Unexpected URL ${url}`)
    })

    ;(globalThis as unknown as { $fetch: typeof fetchMock }).$fetch = fetchMock

    const scannerStore = useIsbnScannerStore()
    await scannerStore.addIsbn(lookupIsbn)

    await scannerStore.addSelectedToLibrary()

    expect(scannerStore.scannedBooks[0]).toMatchObject({
      isbn: lookupIsbn,
      status: 'already_owned',
      selected: false,
      errorMessage: 'This book is already in your library.'
    })
  })
})

function validIsbn13(seed: number) {
  const body = `978${String(seed).padStart(9, '0')}`
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0)
  return `${body}${(10 - (sum % 10)) % 10}`
}
