import type { BookLookupResult } from '~~/shared/types/book'
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

  const isLookingUp = computed(() => pendingLookups.value > 0)
  const isAdding = computed(() => pendingAdds.value > 0)

  function getErrorMessage(err: unknown, fallback: string): string {
    if (err instanceof Error) {
      return err.message
    }

    return (err as { data?: { message?: string } })?.data?.message || fallback
  }

  async function lookupIsbn(
    isbn: string,
    options: { fallbackMessage?: string } = {}
  ): Promise<IsbnLookupSuccess | IsbnLookupFailure> {
    pendingLookups.value += 1
    lookupError.value = null

    try {
      const result = await $fetch<BookLookupResult>('/api/books/lookup', {
        method: 'POST',
        body: { isbn }
      })

      return { ok: true, result }
    } catch (err: unknown) {
      const message = getErrorMessage(err, options.fallbackMessage || 'Failed to lookup book')
      lookupError.value = message
      return { ok: false, message }
    } finally {
      pendingLookups.value -= 1
    }
  }

  async function addIsbnsToLibrary(isbns: string[]): Promise<AddIsbnsResult> {
    if (isbns.length === 0) {
      return { success: [], failed: [], failedIsbns: [] }
    }

    pendingAdds.value += 1
    addError.value = null

    const loadedPagesBeforeAdd = dashboardStore.getLoadedPages()

    try {
      const result = await $fetch<AddIsbnsApiResult>('/api/books/bulk-add', {
        method: 'POST',
        body: { isbns }
      })

      const success = result.added.map(book => book.isbn)
      const failed = result.failed
      const failedIsbns = failed.map(book => book.isbn)

      if (success.length > 0) {
        dashboardStore.markNeedsSync(loadedPagesBeforeAdd)
      }

      return { success, failed, failedIsbns }
    } catch (err: unknown) {
      const message = getErrorMessage(err, 'Failed to add books')
      addError.value = message

      return {
        success: [],
        failed: isbns.map(isbn => ({ isbn, error: message })),
        failedIsbns: isbns
      }
    } finally {
      pendingAdds.value -= 1
    }
  }

  return {
    isLookingUp,
    isAdding,
    lookupError,
    addError,
    getErrorMessage,
    lookupIsbn,
    addIsbnsToLibrary
  }
})
