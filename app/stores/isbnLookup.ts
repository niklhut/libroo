import type { BookLookupResult, BulkBookLookupItem, BulkBookLookupResponse, LibraryState } from '~~/shared/types/book'
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

export const useIsbnLookupStore = defineStore('isbn-lookup', () => {
  const dashboardStore = useLibraryDashboardStore()

  const pendingLookups = ref(0)
  const pendingAdds = ref(0)
  const lookupError = ref<string | null>(null)
  const addError = ref<string | null>(null)
  let resetVersion = 0
  const activeLookupControllers = new Set<AbortController>()

  const isLookingUp = computed(() => pendingLookups.value > 0)
  const isAdding = computed(() => pendingAdds.value > 0)

  function reset() {
    resetVersion += 1
    for (const controller of activeLookupControllers) controller.abort()
    activeLookupControllers.clear()
    pendingLookups.value = 0
    pendingAdds.value = 0
    lookupError.value = null
    addError.value = null
  }

  function getErrorMessage(err: unknown, fallback: string): string {
    return getApiErrorMessage(err, fallback)
  }

  async function lookupIsbn(
    isbn: string,
    options: { fallbackMessage?: string } = {}
  ): Promise<IsbnLookupSuccess | IsbnLookupFailure> {
    const requestVersion = resetVersion
    pendingLookups.value += 1
    lookupError.value = null

    try {
      const result = await $fetch<BookLookupResult>('/api/books/lookup', {
        method: 'POST',
        body: { isbn }
      })

      return requestVersion === resetVersion
        ? { ok: true, result }
        : { ok: false, message: options.fallbackMessage || 'Failed to lookup book' }
    } catch (err: unknown) {
      const message = getErrorMessage(err, options.fallbackMessage || 'Failed to lookup book')
      if (requestVersion === resetVersion) lookupError.value = message
      return { ok: false, message }
    } finally {
      if (requestVersion === resetVersion) {
        pendingLookups.value = Math.max(0, pendingLookups.value - 1)
      }
    }
  }

  async function bulkLookupIsbns(
    isbns: string[],
    options: { onBatchStart?: (count: number) => void, onItemsComplete?: (count: number) => void } = {}
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

        try {
          const response = await $fetch<BulkBookLookupResponse>('/api/books/bulk-lookup', {
            method: 'POST',
            body: { isbns: batch },
            signal: controller.signal
          })
          if (requestVersion !== resetVersion) break
          items.push(...response.items.map(item => ({
            ...item,
            inputIndex: item.inputIndex + start,
            ...(item.duplicateOf === undefined ? {} : { duplicateOf: item.duplicateOf + start })
          })))
        } catch (err: unknown) {
          if (requestVersion !== resetVersion || controller.signal.aborted) break
          const message = getErrorMessage(err, 'Failed to look up books')
          lookupError.value = message
          items.push(...batch.map((isbn, index): BulkBookLookupItem => ({
            inputIndex: start + index,
            input: isbn,
            normalizedIsbn: isbn,
            status: 'error',
            errorCode: 'upstream_failure',
            message
          })))
        } finally {
          activeLookupControllers.delete(controller)
          if (requestVersion === resetVersion) options.onItemsComplete?.(batch.length)
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
    pendingLookups,
    pendingAdds,
    lookupError,
    addError,
    getErrorMessage,
    lookupIsbn,
    bulkLookupIsbns,
    addIsbnsToLibrary,
    reset
  }
})
