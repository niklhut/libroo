import type { LibraryBook, LibraryBookEnrichmentUpdate } from '~~/shared/types/book'
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

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 12
const DEFAULT_SORT = 'dateAdded' satisfies LibrarySort
export const MAX_DASHBOARD_RESULT_CACHE_ENTRIES = 10

export const useLibraryDashboardStore = defineStore('library-dashboard', () => {
  const page = ref(DEFAULT_PAGE)
  const pageSize = ref(DEFAULT_PAGE_SIZE)
  const allBooks = ref<LibraryBook[]>([])
  // Successful additions are retained until a library response confirms them.
  // This bridges route changes and prevents an early refresh from hiding a new book.
  const pendingAddedBooks = ref<LibraryBook[]>([])
  const pagination = ref<DashboardPagination | null>(null)
  const resultCache = ref<Record<string, DashboardResultCacheEntry>>({})
  const search = ref('')
  const loanStatus = ref<LibraryLoanFilter>('all')
  const libraryState = ref<LibraryStateFilter>([...DEFAULT_LIBRARY_STATE_FILTER])
  const readingStatus = ref<LibraryReadingFilter>('all')
  const tags = ref<string[]>([])
  const location = ref('')
  const locationId = ref('')
  const includeLocationDescendants = ref(false)
  const sortBy = ref<LibrarySort>(DEFAULT_SORT)
  const groupByLocation = ref(false)
  const scrollY = ref(0)
  const shouldRestoreScroll = ref(false)
  const shouldSync = ref(false)
  const syncTargetPages = ref(DEFAULT_PAGE)
  const pendingEnrichmentUpdates = ref<Record<string, LibraryBookEnrichmentUpdate>>({})
  const resultCacheKeyOrder = ref<string[]>([])
  const enrichmentBatchRuns = new Map<string, {
    controller: AbortController
    timer: ReturnType<typeof setTimeout> | null
  }>()

  function getLoadedPages() {
    return Math.max(1, Math.ceil(allBooks.value.length / pageSize.value))
  }

  function canOptimisticallyDisplayBook(book: LibraryBook) {
    return page.value === 1
      && !search.value.trim()
      && loanStatus.value === 'all'
      && readingStatus.value === 'all'
      && tags.value.length === 0
      && !location.value
      && !locationId.value
      && !includeLocationDescendants.value
      && sortBy.value === 'dateAdded'
      && (libraryState.value.length === 0 || libraryState.value.includes(book.libraryState))
  }

  function addBook(book: LibraryBook) {
    resultCache.value = {}
    resultCacheKeyOrder.value = []
    pendingAddedBooks.value = [
      ...pendingAddedBooks.value.filter(item => item.id !== book.id),
      book
    ]
    if (!canOptimisticallyDisplayBook(book)) return

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

  function getPendingAddedBooks() {
    return [...pendingAddedBooks.value]
  }

  function clearPendingAddedBooks(ids: string[]) {
    if (ids.length === 0) return
    const confirmed = new Set(ids)
    pendingAddedBooks.value = pendingAddedBooks.value.filter(book => !confirmed.has(book.id))
  }

  function removeBooks(removedIds: string[]) {
    if (removedIds.length === 0) return

    const removedIdSet = new Set(removedIds)
    pendingEnrichmentUpdates.value = Object.fromEntries(
      Object.entries(pendingEnrichmentUpdates.value).filter(([id]) => !removedIdSet.has(id))
    )
    pendingAddedBooks.value = pendingAddedBooks.value.filter(book => !removedIdSet.has(book.id))
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

  function updateBookTags(userBookId: string, tags: string[]) {
    const updateTags = (book: LibraryBook) => book.id === userBookId
      ? { ...book, tags: [...tags] }
      : book

    allBooks.value = allBooks.value.map(updateTags)
    resultCache.value = Object.fromEntries(
      Object.entries(resultCache.value).map(([key, entry]) => [key, {
        ...entry,
        books: entry.books.map(updateTags)
      }])
    )
    const pending = pendingEnrichmentUpdates.value[userBookId]
    if (pending) {
      pendingEnrichmentUpdates.value[userBookId] = {
        ...pending,
        tags: [...tags],
        suggestedTags: pending.suggestedTags?.filter(tag => !tags.includes(tag))
      }
    }
  }

  function updateBookEnrichment(userBookId: string, update: LibraryBookEnrichmentUpdate) {
    const knownBooks = [
      ...allBooks.value,
      ...pendingAddedBooks.value,
      ...Object.values(resultCache.value).flatMap(entry => entry.books)
    ]
    const currentBook = knownBooks.find(book => book.id === userBookId && book.bookId === update.bookId)
    const currentTags = currentBook?.tags ?? update.tags
    const normalizedUpdate: LibraryBookEnrichmentUpdate = {
      ...update,
      ...(currentTags ? { tags: [...currentTags] } : {}),
      ...(update.suggestedTags
        ? { suggestedTags: update.suggestedTags.filter(tag => !currentTags?.includes(tag)) }
        : {})
    }

    pendingEnrichmentUpdates.value[userBookId] = normalizedUpdate
    const patchBook = (book: LibraryBook): LibraryBook => {
      if (book.id !== userBookId || book.bookId !== normalizedUpdate.bookId) return book
      return {
        ...book,
        author: normalizedUpdate.author,
        coverPath: normalizedUpdate.coverPath,
        description: normalizedUpdate.description ?? null,
        publishDate: normalizedUpdate.publishDate ?? null,
        publishers: Array.isArray(normalizedUpdate.publishers) ? normalizedUpdate.publishers.join(', ') : (normalizedUpdate.publishers ?? null),
        numberOfPages: normalizedUpdate.numberOfPages ?? null,
        openLibraryKey: normalizedUpdate.openLibraryKey ?? null,
        workKey: normalizedUpdate.workKey ?? null,
        enrichmentStatus: normalizedUpdate.status,
        ...(normalizedUpdate.tags ? { tags: [...normalizedUpdate.tags] } : {}),
        ...(normalizedUpdate.suggestedTags ? { suggestedTags: [...normalizedUpdate.suggestedTags] } : {})
      }
    }

    const patchPending = (book: LibraryBook) => patchBook(book)

    allBooks.value = allBooks.value.map(patchBook)
    pendingAddedBooks.value = pendingAddedBooks.value.map(patchPending)
    resultCache.value = Object.fromEntries(
      Object.entries(resultCache.value).map(([key, entry]) => [key, {
        ...entry,
        books: entry.books.map(patchBook)
      }])
    )
  }

  function applyPendingEnrichmentUpdates() {
    for (const [userBookId, update] of Object.entries(pendingEnrichmentUpdates.value)) {
      if (allBooks.value.some(book => book.id === userBookId && book.bookId === update.bookId)) {
        updateBookEnrichment(userBookId, update)
        const { [userBookId]: _applied, ...remaining } = pendingEnrichmentUpdates.value
        pendingEnrichmentUpdates.value = remaining
      }
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

  function cancelEnrichmentBatches() {
    for (const run of enrichmentBatchRuns.values()) {
      if (run.timer) clearTimeout(run.timer)
      run.controller.abort()
    }
    enrichmentBatchRuns.clear()
  }

  function startEnrichmentBatch(batchId: string) {
    if (enrichmentBatchRuns.has(batchId)) return
    const run = {
      controller: new AbortController(),
      timer: null as ReturnType<typeof setTimeout> | null
    }
    enrichmentBatchRuns.set(batchId, run)
    void (async () => {
      let failures = 0
      while (enrichmentBatchRuns.get(batchId) === run) {
        try {
          const result = await $fetch<{
            claimed: number
            pending?: number
            nextAttemptAt?: string | null
            updates?: LibraryBookEnrichmentUpdate[]
          }>('/api/books/enrichment/batch', {
            method: 'POST',
            body: { batchId },
            signal: run.controller.signal
          })
          if (enrichmentBatchRuns.get(batchId) !== run) return
          failures = 0
          for (const update of result.updates ?? []) updateBookEnrichment(update.userBookId, update)
          const pending = result.pending ?? 0
          if (pending === 0) break
          const retryAt = result.nextAttemptAt ? Date.parse(result.nextAttemptAt) : NaN
          const delay = Number.isFinite(retryAt)
            ? Math.min(2_147_483_647, Math.max(1000, retryAt - Date.now()))
            : (result.claimed > 0 ? 1000 : 5000)
          await new Promise<void>((resolve) => {
            const finish = () => {
              run.controller.signal.removeEventListener('abort', finish)
              run.timer = null
              resolve()
            }
            run.controller.signal.addEventListener('abort', finish, { once: true })
            run.timer = setTimeout(finish, delay)
          })
        } catch (error: unknown) {
          if (enrichmentBatchRuns.get(batchId) !== run || run.controller.signal.aborted) return
          const status = typeof error === 'object' && error !== null
            ? Number((error as { statusCode?: number, status?: number }).statusCode ?? (error as { status?: number }).status)
            : 0
          if ([401, 403, 404].includes(status)) break
          failures += 1
          if (failures > 4) break
          const delay = Math.min(30_000, 1000 * 2 ** (failures - 1))
          await new Promise<void>((resolve) => {
            const finish = () => {
              run.controller.signal.removeEventListener('abort', finish)
              run.timer = null
              resolve()
            }
            run.controller.signal.addEventListener('abort', finish, { once: true })
            run.timer = setTimeout(finish, delay)
          })
        }
      }
    })().catch((error) => {
      console.error('Failed to start CSV enrichment batch', error)
    }).finally(() => {
      const current = enrichmentBatchRuns.get(batchId)
      if (current === run) {
        if (run.timer) clearTimeout(run.timer)
        enrichmentBatchRuns.delete(batchId)
      }
    })
  }

  function resetResults() {
    page.value = DEFAULT_PAGE
    allBooks.value = []
    pagination.value = null
  }

  function resetAll() {
    page.value = DEFAULT_PAGE
    pageSize.value = DEFAULT_PAGE_SIZE
    allBooks.value = []
    pagination.value = null
    resultCache.value = {}
    resultCacheKeyOrder.value = []
    search.value = ''
    loanStatus.value = 'all'
    libraryState.value = [...DEFAULT_LIBRARY_STATE_FILTER]
    readingStatus.value = 'all'
    tags.value = []
    location.value = ''
    locationId.value = ''
    includeLocationDescendants.value = false
    sortBy.value = DEFAULT_SORT
    groupByLocation.value = false
    scrollY.value = 0
    shouldRestoreScroll.value = false
    shouldSync.value = false
    syncTargetPages.value = DEFAULT_PAGE
    cancelEnrichmentBatches()
    pendingAddedBooks.value = []
    pendingEnrichmentUpdates.value = {}
  }

  function cacheResults(cacheKey: string) {
    if (!cacheKey || !pagination.value) return

    resultCacheKeyOrder.value = resultCacheKeyOrder.value.filter(key => key !== cacheKey)
    resultCache.value[cacheKey] = {
      books: [...allBooks.value],
      pagination: { ...pagination.value },
      loadedPage: page.value
    }
    resultCacheKeyOrder.value.push(cacheKey)

    while (resultCacheKeyOrder.value.length > MAX_DASHBOARD_RESULT_CACHE_ENTRIES) {
      const oldestKey = resultCacheKeyOrder.value.shift()
      if (oldestKey) {
        const { [oldestKey]: _evictedEntry, ...remainingEntries } = resultCache.value
        resultCache.value = remainingEntries
      }
    }
  }

  function restoreCachedResults(cacheKey: string) {
    const cached = resultCache.value[cacheKey]
    if (!cached) return null

    allBooks.value = [...cached.books]
    pagination.value = { ...cached.pagination }
    page.value = cached.loadedPage
    resultCacheKeyOrder.value = [
      ...resultCacheKeyOrder.value.filter(key => key !== cacheKey),
      cacheKey
    ]

    return cached
  }

  return {
    page,
    pageSize,
    allBooks,
    pendingAddedBooks,
    pagination,
    resultCache,
    pendingEnrichmentUpdates,
    search,
    loanStatus,
    libraryState,
    readingStatus,
    tags,
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
    canOptimisticallyDisplayBook,
    addBook,
    removeBooks,
    updateBookTags,
    updateBookEnrichment,
    applyPendingEnrichmentUpdates,
    markNeedsSync,
    clearNeedsSync,
    startEnrichmentBatch,
    resetResults,
    resetAll,
    cacheResults,
    restoreCachedResults,
    getPendingAddedBooks,
    clearPendingAddedBooks
  }
})
