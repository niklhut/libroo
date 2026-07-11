import type { BookLookupResult, LibraryState } from '~~/shared/types/book'
import { getApiErrorMessage } from '~~/shared/utils/api-error'
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

  const isLookingUp = computed(() => pendingLookups.value > 0)
  const isAdding = computed(() => pendingAdds.value > 0)

  function reset() {
    resetVersion += 1
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
      pendingLookups.value = Math.max(0, pendingLookups.value - 1)
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

    try {
      const result = await $fetch<AddIsbnsApiResult>('/api/books/bulk-add', {
        method: 'POST',
        body: { books: isbns.map(isbn => ({ isbn, libraryState })) }
      })

      if (requestVersion !== resetVersion) {
        return { success: [], failed: [], failedIsbns: [] }
      }

      const success = result.added.map(book => book.isbn)
      const failed = result.failed
      const failedIsbns = failed.map(book => book.isbn)

      if (success.length > 0) {
        dashboardStore.markNeedsSync(loadedPagesBeforeAdd)
      }

      return { success, failed, failedIsbns }
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to add books')
      if (requestVersion === resetVersion) addError.value = message

      return {
        success: [],
        failed: isbns.map(isbn => ({ isbn, error: message })),
        failedIsbns: isbns
      }
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
    addIsbnsToLibrary,
    reset
  }
})
