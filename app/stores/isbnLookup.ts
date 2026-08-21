import type { BookEnrichmentPatch, BookLookupResult, BulkBookLookupItem, BulkBookLookupResponse, LibraryState } from '~~/shared/types/book'
import { getApiErrorMessage } from '~~/shared/utils/api-error'
import { MAX_BULK_ISBN_COUNT } from '~~/shared/utils/schemas'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { useLibraryDashboardStore } from './libraryDashboard'

interface IsbnLookupSuccess {
  ok: true
  result: BookLookupResult
}

interface IsbnLookupFailure {
  ok: false
  message: string
}

interface AddIsbnsApiResult {
  added: Array<{ isbn: string }>
  failed: Array<{ isbn: string, error: string }>
}

export interface AddIsbnsResult {
  success: string[]
  failed: Array<{ isbn: string, error: string }>
  failedIsbns: string[]
}

interface BulkLookupOptions {
  onBatchStart?: (count: number) => void
  onBatchComplete?: (items: BulkBookLookupItem[]) => void
}

export const useIsbnLookupStore = defineStore('isbn-lookup', () => {
  const dashboardStore = useLibraryDashboardStore()

  const pendingLookups = ref(0)
  const pendingAdds = ref(0)
  const lookupError = ref<string | null>(null)
  const addError = ref<string | null>(null)
  const enrichmentError = ref<string | null>(null)
  const pendingEnrichments = ref(0)
  // Keep the reactive object that receives asynchronous enrichment patches.
  // Consumers get this same proxy, rather than a raw $fetch object.
  const activeLookupResult = ref<BookLookupResult | null>(null)
  let resetVersion = 0
  let activeLookupRequest = 0
  const activeLookupControllers = new Set<AbortController>()
  const activeEnrichmentControllers = new Map<number, Set<AbortController>>()

  const isLookingUp = computed(() => pendingLookups.value > 0)
  const isAdding = computed(() => pendingAdds.value > 0)
  const isEnriching = computed(() => pendingEnrichments.value > 0)

  function reset() {
    resetVersion += 1
    for (const controller of activeLookupControllers) controller.abort()
    activeLookupControllers.clear()
    for (const controllers of activeEnrichmentControllers.values()) {
      for (const controller of controllers) controller.abort()
    }
    activeEnrichmentControllers.clear()
    pendingLookups.value = 0
    pendingAdds.value = 0
    pendingEnrichments.value = 0
    lookupError.value = null
    addError.value = null
    enrichmentError.value = null
    activeLookupResult.value = null
  }

  function getErrorMessage(err: unknown, fallback: string): string {
    return getApiErrorMessage(err, fallback)
  }

  function isPending(enrichment: BookLookupResult['enrichment']) {
    return enrichment?.status === 'queued' || enrichment?.status === 'preparing' || enrichment?.status === 'retrying'
  }

  function isActiveRequest(requestVersion: number, requestId: number) {
    return requestVersion === resetVersion && requestId === activeLookupRequest
  }

  function registerEnrichmentController(requestVersion: number, controller: AbortController) {
    const controllers = activeEnrichmentControllers.get(requestVersion) ?? new Set<AbortController>()
    controllers.add(controller)
    activeEnrichmentControllers.set(requestVersion, controllers)
  }

  function unregisterEnrichmentController(requestVersion: number, controller: AbortController) {
    const controllers = activeEnrichmentControllers.get(requestVersion)
    if (!controllers) return
    controllers.delete(controller)
    if (controllers.size === 0) activeEnrichmentControllers.delete(requestVersion)
  }

  async function enrichResult(result: BookLookupResult, requestVersion: number, requestId: number, attempt = 0): Promise<void> {
    if (!result.bookId || !isPending(result.enrichment) || !isActiveRequest(requestVersion, requestId)) return
    const controller = new AbortController()
    registerEnrichmentController(requestVersion, controller)
    pendingEnrichments.value += 1
    try {
      const patch = await $fetch<BookEnrichmentPatch>('/api/books/enrichment/run', {
        method: 'POST',
        body: { bookId: result.bookId },
        signal: controller.signal
      })
      if (!isActiveRequest(requestVersion, requestId) || patch.bookId !== result.bookId) return
      result.author = patch.author
      result.authors = patch.authors
      result.coverUrl = patch.coverUrl
      result.description = patch.description
      result.subjects = patch.subjects
      result.publishDate = patch.publishDate
      result.publishers = patch.publishers
      result.numberOfPages = patch.numberOfPages
      result.enrichment = { status: patch.status }
      if (isPending(result.enrichment) && attempt < 4) {
        window.setTimeout(() => {
          void enrichResult(result, requestVersion, requestId, attempt + 1)
        }, 1500 * (attempt + 1))
      }
    } catch (err: unknown) {
      if (isActiveRequest(requestVersion, requestId)) {
        enrichmentError.value = getErrorMessage(err, 'Book details are still being prepared')
      }
    } finally {
      unregisterEnrichmentController(requestVersion, controller)
      if (requestVersion === resetVersion) {
        pendingEnrichments.value = Math.max(0, pendingEnrichments.value - 1)
      }
    }
  }

  async function lookupIsbn(
    isbn: string,
    options: { fallbackMessage?: string } = {}
  ): Promise<IsbnLookupSuccess | IsbnLookupFailure> {
    const requestVersion = resetVersion
    const requestId = ++activeLookupRequest
    pendingLookups.value += 1
    lookupError.value = null

    try {
      const response = await $fetch<BookLookupResult>('/api/books/lookup', {
        method: 'POST',
        body: { isbn }
      })
      if (!isActiveRequest(requestVersion, requestId)) {
        return { ok: false, message: options.fallbackMessage || 'Failed to lookup book' }
      }
      activeLookupResult.value = response
      const result = activeLookupResult.value!

      if (result.found && result.enrichment && isPending(result.enrichment)) {
        void enrichResult(result, requestVersion, requestId)
      }
      return { ok: true, result }
    } catch (err: unknown) {
      const message = getErrorMessage(err, options.fallbackMessage || 'Failed to lookup book')
      if (isActiveRequest(requestVersion, requestId)) lookupError.value = message
      return { ok: false, message }
    } finally {
      pendingLookups.value = Math.max(0, pendingLookups.value - 1)
    }
  }

  async function bulkLookupIsbns(
    isbns: string[],
    options: BulkLookupOptions = {}
  ): Promise<BulkBookLookupResponse> {
    if (isbns.length === 0) return { items: [] }

    const requestVersion = resetVersion
    pendingLookups.value += 1
    lookupError.value = null
    const items: BulkBookLookupItem[] = []

    try {
      for (let start = 0; start < isbns.length; start += MAX_BULK_ISBN_COUNT) {
        if (requestVersion !== resetVersion) break
        const batch = isbns.slice(start, start + MAX_BULK_ISBN_COUNT)
        const controller = new AbortController()
        activeLookupControllers.add(controller)
        options.onBatchStart?.(batch.length)
        let batchItems: BulkBookLookupItem[] = []

        try {
          const response = await $fetch<BulkBookLookupResponse>('/api/books/bulk-lookup', {
            method: 'POST',
            body: { isbns: batch },
            signal: controller.signal
          })
          if (requestVersion !== resetVersion) break
          batchItems = response.items.map(item => ({
            ...item,
            inputIndex: item.inputIndex + start,
            ...(item.duplicateOf === undefined ? {} : { duplicateOf: item.duplicateOf + start })
          }))
        } catch (err: unknown) {
          if (requestVersion !== resetVersion || controller.signal.aborted) break
          const message = getErrorMessage(err, 'Failed to look up books')
          lookupError.value = message
          batchItems = batch.map((isbn, index): BulkBookLookupItem => ({
            inputIndex: start + index,
            input: isbn,
            normalizedIsbn: isbn,
            status: 'error',
            errorCode: 'upstream_failure',
            message
          }))
        } finally {
          activeLookupControllers.delete(controller)
        }

        if (requestVersion === resetVersion) {
          items.push(...batchItems)
          options.onBatchComplete?.(batchItems)
        }
      }

      return requestVersion === resetVersion ? { items } : { items: [] }
    } finally {
      if (requestVersion === resetVersion) {
        pendingLookups.value = Math.max(0, pendingLookups.value - 1)
      }
    }
  }

  async function addIsbnsToLibrary(isbns: string[], libraryState: LibraryState = 'owned'): Promise<AddIsbnsResult> {
    if (isbns.length === 0) {
      return { success: [], failed: [], failedIsbns: [] }
    }

    const requestVersion = resetVersion
    pendingAdds.value += 1
    addError.value = null

    const loadedPagesBeforeAdd = dashboardStore.getLoadedPages()

    const success: string[] = []
    const failed: Array<{ isbn: string, error: string }> = []

    try {
      for (let start = 0; start < isbns.length; start += MAX_BULK_ISBN_COUNT) {
        const batch = isbns.slice(start, start + MAX_BULK_ISBN_COUNT)

        try {
          const result = await $fetch<AddIsbnsApiResult>('/api/books/bulk-add', {
            method: 'POST',
            body: { books: batch.map(isbn => ({ isbn, libraryState })) }
          })
          success.push(...result.added.map(book => book.isbn))
          failed.push(...result.failed)

          if (requestVersion !== resetVersion) break
        } catch (err: unknown) {
          const message = getErrorMessage(err, 'Failed to add books')
          if (requestVersion !== resetVersion) break

          addError.value = message
          failed.push(...batch.map(isbn => ({ isbn, error: message })))
        }
      }

      if (success.length > 0) dashboardStore.markNeedsSync(loadedPagesBeforeAdd)

      return requestVersion === resetVersion
        ? { success, failed, failedIsbns: failed.map(book => book.isbn) }
        : { success: [], failed: [], failedIsbns: [] }
    } finally {
      pendingAdds.value = Math.max(0, pendingAdds.value - 1)
    }
  }

  return {
    isLookingUp,
    isAdding,
    isEnriching,
    pendingLookups,
    pendingAdds,
    lookupError,
    addError,
    enrichmentError,
    activeLookupResult,
    getErrorMessage,
    lookupIsbn,
    bulkLookupIsbns,
    addIsbnsToLibrary,
    reset
  }
})
