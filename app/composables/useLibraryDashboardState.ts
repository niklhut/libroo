import type { LibraryBook } from '~~/shared/types/book'

interface DashboardPagination {
  page: number
  pageSize: number
  totalItems: number
  totalPages: number
  hasMore: boolean
}

export function useLibraryDashboardState() {
  const page = useState<number>('library-dashboard-page', () => 1)
  const pageSize = useState<number>('library-dashboard-page-size', () => 12)
  const allBooks = useState<LibraryBook[]>('library-dashboard-books', () => [])
  const pagination = useState<DashboardPagination | null>('library-dashboard-pagination', () => null)
  const scrollY = useState<number>('library-dashboard-scroll-y', () => 0)
  const shouldRestoreScroll = useState<boolean>('library-dashboard-restore-scroll', () => false)
  const shouldSync = useState<boolean>('library-dashboard-should-sync', () => false)
  const syncTargetPages = useState<number>('library-dashboard-sync-target-pages', () => 1)

  function getLoadedPages() {
    return Math.max(1, Math.ceil(allBooks.value.length / pageSize.value))
  }

  function addBook(book: LibraryBook) {
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

  return {
    page,
    pageSize,
    allBooks,
    pagination,
    scrollY,
    shouldRestoreScroll,
    shouldSync,
    syncTargetPages,
    getLoadedPages,
    addBook,
    removeBooks,
    markNeedsSync,
    clearNeedsSync
  }
}
