import type { LibraryBook } from '~~/shared/types/book'
import type { LibraryLoanFilter, LibraryReadingFilter, LibrarySort, LibraryStateFilter } from '~~/shared/utils/library-query'
import { DEFAULT_LIBRARY_STATE_FILTER } from '~~/shared/utils/library-query'
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface DashboardPagination {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasMore: boolean
}

export interface DashboardResultCacheEntry {
  books: LibraryBook[]
  pagination: DashboardPagination
  loadedPage: number
}

export const useLibraryDashboardStore = defineStore('library-dashboard', () => {
  const page = ref(1)
  const pageSize = ref(12)
  const allBooks = ref<LibraryBook[]>([])
  const pagination = ref<DashboardPagination | null>(null)
  const resultCache = ref<Record<string, DashboardResultCacheEntry>>({})
  const search = ref('')
  const loanStatus = ref<LibraryLoanFilter>('all')
  const libraryState = ref<LibraryStateFilter>([...DEFAULT_LIBRARY_STATE_FILTER])
  const readingStatus = ref<LibraryReadingFilter>('all')
  const tag = ref('')
  const location = ref('')
  const locationId = ref('')
  const includeLocationDescendants = ref(false)
  const sortBy = ref<LibrarySort>('dateAdded')
  const groupByLocation = ref(false)
  const scrollY = ref(0)
  const shouldRestoreScroll = ref(false)
  const shouldSync = ref(false)
  const syncTargetPages = ref(1)

  function getLoadedPages() {
    return Math.max(1, Math.ceil(allBooks.value.length / pageSize.value))
  }

  function addBook(book: LibraryBook) {
    if (libraryState.value.length > 0 && !libraryState.value.includes(book.libraryState)) return

    const existingIndex = allBooks.value.findIndex(item => item.id === book.id)
    const existed = existingIndex !== -1

    if (existed) {
      allBooks.value.splice(existingIndex, 1)
    }

    allBooks.value.unshift(book)

    if (!pagination.value || existed) return

    const totalItems = pagination.value.totalItems + 1
    const totalPages = Math.ceil(totalItems / pagination.value.pageSize)

    pagination.value = {
      ...pagination.value,
      totalItems,
      totalPages,
      hasMore: page.value < totalPages
    }
  }

  function removeBooks(removedIds: string[]) {
    if (removedIds.length === 0) return

    const removedIdSet = new Set(removedIds)
    const previousLength = allBooks.value.length
    allBooks.value = allBooks.value.filter(book => !removedIdSet.has(book.id))
    const removedCount = previousLength - allBooks.value.length

    if (removedCount <= 0 || !pagination.value) return

    const totalItems = Math.max(0, pagination.value.totalItems - removedCount)
    const totalPages = Math.ceil(totalItems / pagination.value.pageSize)

    if (page.value > Math.max(1, totalPages)) {
      page.value = Math.max(1, totalPages)
    }

    pagination.value = {
      ...pagination.value,
      totalItems,
      totalPages,
      hasMore: page.value < totalPages
    }
  }

  function markNeedsSync(targetPages = getLoadedPages()) {
    shouldSync.value = true
    syncTargetPages.value = Math.max(1, targetPages)
  }

  function clearNeedsSync() {
    shouldSync.value = false
    syncTargetPages.value = 1
  }

  function resetResults() {
    page.value = 1
    allBooks.value = []
    pagination.value = null
  }

  function cacheResults(cacheKey: string) {
    if (!cacheKey || !pagination.value) return

    resultCache.value[cacheKey] = {
      books: [...allBooks.value],
      pagination: { ...pagination.value },
      loadedPage: page.value
    }
  }

  function restoreCachedResults(cacheKey: string) {
    const cached = resultCache.value[cacheKey]
    if (!cached) return null

    allBooks.value = [...cached.books]
    pagination.value = { ...cached.pagination }
    page.value = cached.loadedPage

    return cached
  }

  return {
    page,
    pageSize,
    allBooks,
    pagination,
    resultCache,
    search,
    loanStatus,
    libraryState,
    readingStatus,
    tag,
    location,
    locationId,
    includeLocationDescendants,
    sortBy,
    groupByLocation,
    scrollY,
    shouldRestoreScroll,
    shouldSync,
    syncTargetPages,
    getLoadedPages,
    addBook,
    removeBooks,
    markNeedsSync,
    clearNeedsSync,
    resetResults,
    cacheResults,
    restoreCachedResults
  }
})
