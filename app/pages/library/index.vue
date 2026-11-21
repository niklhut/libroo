<script setup lang="ts">
import type { DashboardPagination } from '~/stores/libraryDashboard'
import type { LibraryBook, LibraryBookEnrichmentUpdate, BookLocationWithCount, LibraryState, TagWithCount } from '~~/shared/types/book'
import {
  buildLibraryRouteQuery,
  DEFAULT_LIBRARY_STATE_FILTER,
  describeActiveLibraryFilters,
  getActiveLibraryFilterCount,
  hasLibraryStateFilter,
  libraryStateFilterValues,
  libraryStateLabels,
  normalizeLibraryQuery
} from '~~/shared/utils/library-query'

interface PaginatedResponse {
  items: LibraryBook[]
  pagination: DashboardPagination
}

interface PreferencesResponse {
  defaultLibraryStateFilter: LibraryState[]
}

usePageTitle('Library')

const toast = useToast()
const route = useRoute()
const authStore = useAuthStore()

const routeState = normalizeLibraryQuery(route.query)
const hasExplicitLibraryStateQuery = route.query.libraryState !== undefined

const dashboardStore = useLibraryDashboardStore()
const {
  page,
  pageSize,
  allBooks,
  pagination: paginationState,
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
  syncTargetPages
} = storeToRefs(dashboardStore)

const layout = useCookie<'shelves' | 'grid'>('libroo-library-layout', { default: () => 'grid', sameSite: 'lax' })
const useShelfPagination = computed(() => layout.value === 'shelves' && !search.value.trim())

const {
  clearNeedsSync: clearNeedsSyncAction,
  cacheResults: cacheResultsAction,
  updateBookEnrichment,
  applyPendingEnrichmentUpdates,
  restoreCachedResults: restoreCachedResultsAction,
  resetResults: resetResultsAction,
  getPendingAddedBooks,
  clearPendingAddedBooks
} = dashboardStore

const { data: preferences } = await useFetch<PreferencesResponse>('/api/preferences', {
  headers: useRequestHeaders(['cookie']),
  lazy: hasExplicitLibraryStateQuery || dashboardStore.getPendingAddedBooks().length > 0
})

const initialLibraryState: LibraryState[] = hasExplicitLibraryStateQuery
  ? routeState.libraryState ?? DEFAULT_LIBRARY_STATE_FILTER
  : (preferences.value?.defaultLibraryStateFilter
    ?? (dashboardStore.getPendingAddedBooks()[0]?.libraryState
      ? [dashboardStore.getPendingAddedBooks()[0]!.libraryState]
      : DEFAULT_LIBRARY_STATE_FILTER))
const hasRouteStateMismatch = pageSize.value !== routeState.pageSize
  || search.value !== (routeState.search ?? '')
  || loanStatus.value !== (routeState.loanStatus ?? 'all')
  || libraryState.value.join(',') !== initialLibraryState.join(',')
  || readingStatus.value !== (routeState.readingStatus ?? 'all')
  || tags.value.join(',') !== (routeState.tags ?? []).join(',')
  || location.value !== (routeState.location ?? '')
  || locationId.value !== (routeState.locationId ?? '')
  || includeLocationDescendants.value !== Boolean(routeState.includeLocationDescendants)
  || sortBy.value !== (routeState.sortBy ?? 'dateAdded')
  || (!!paginationState.value && !!paginationState.value.perShelf !== useShelfPagination.value)
const hasCachedResults = paginationState.value !== null

if (hasRouteStateMismatch) {
  resetResultsAction()
}

if (hasRouteStateMismatch || !hasCachedResults) {
  page.value = routeState.page
}
pageSize.value = routeState.pageSize
search.value = routeState.search ?? ''
loanStatus.value = routeState.loanStatus ?? 'all'
libraryState.value = [...initialLibraryState]
readingStatus.value = routeState.readingStatus ?? 'all'
tags.value = [...(routeState.tags ?? [])]
location.value = routeState.location ?? ''
locationId.value = routeState.locationId ?? ''
includeLocationDescendants.value = Boolean(routeState.includeLocationDescendants)
sortBy.value = routeState.sortBy ?? 'dateAdded'

const pendingBooksForView = dashboardStore.getPendingAddedBooks()
  .filter(book => dashboardStore.canOptimisticallyDisplayBook(book))
if (pendingBooksForView.length > 0) {
  const pendingIds = new Set(pendingBooksForView.map(book => book.id))
  allBooks.value = [...pendingBooksForView, ...allBooks.value.filter(book => !pendingIds.has(book.id))]
  if (!paginationState.value) {
    paginationState.value = {
      page: 1,
      pageSize: pageSize.value,
      totalItems: pendingBooksForView.length,
      totalPages: 1,
      hasMore: false
    }
  }
}

// Pagination state
const isLoadingMore = ref(false)
const isApplyingFilters = ref(false)
const filterRefreshTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const preferenceSaveTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const enrichmentPollTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const isEnrichmentPollActive = ref(import.meta.client && !document.hidden)
const enrichmentPollFailures = ref(0)
const shouldPersistLibraryStatePreference = ref(false)
const suppressFilterWatcher = ref(false)
const ALL_LOCATIONS_VALUE = '__all_locations__'
const areFiltersExpanded = ref(false)
const showPhysicalFilters = computed(() => libraryState.value.length === 0 || libraryState.value.includes('owned'))

function getLibraryResultCacheKey() {
  const hasPhysicalFilters = showPhysicalFilters.value

  return JSON.stringify({
    pageSize: pageSize.value,
    perShelf: useShelfPagination.value,
    search: search.value.trim(),
    libraryState: [...libraryState.value],
    loanStatus: hasPhysicalFilters ? loanStatus.value : 'all',
    readingStatus: hasPhysicalFilters ? readingStatus.value : 'all',
    tags: [...tags.value],
    location: hasPhysicalFilters ? location.value.trim() : '',
    locationId: hasPhysicalFilters ? locationId.value : '',
    includeLocationDescendants: hasPhysicalFilters ? includeLocationDescendants.value : false,
    sortBy: sortBy.value
  })
}

const activeResultCacheKey = ref(getLibraryResultCacheKey())
// A successful empty response is a cached result too.
const shouldFetchInitial = !paginationState.value

function pendingBookMatchesFilters(book: LibraryBook) {
  return dashboardStore.canOptimisticallyDisplayBook(book)
}

// These auxiliary filters do not affect the initial book query. Start them
// without blocking route rendering so the library can appear immediately.
const { data: locations } = useFetch<BookLocationWithCount[]>('/api/locations', {
  headers: useRequestHeaders(['cookie']),
  lazy: true
})
const { data: availableTags } = useFetch<TagWithCount[]>('/api/tags', {
  headers: useRequestHeaders(['cookie']),
  lazy: true
})

// Fetch books with pagination
const bookQuery = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  layout: useShelfPagination.value ? 'shelf-index' : undefined,
  search: search.value || undefined,
  libraryState: hasLibraryStateFilter(libraryState.value) ? libraryState.value.join(',') : undefined,
  loanStatus: showPhysicalFilters.value && loanStatus.value !== 'all' ? loanStatus.value : undefined,
  readingStatus: showPhysicalFilters.value && readingStatus.value !== 'all' ? readingStatus.value : undefined,
  tags: tags.value.length ? tags.value.join(',') : undefined,
  location: showPhysicalFilters.value ? location.value || undefined : undefined,
  locationId: showPhysicalFilters.value ? locationId.value || undefined : undefined,
  includeLocationDescendants: showPhysicalFilters.value ? includeLocationDescendants.value || undefined : undefined,
  sortBy: sortBy.value === 'dateAdded' ? undefined : sortBy.value
}))
const { data, refresh, status, error: libraryFetchError } = await useFetch<PaginatedResponse>('/api/books', {
  headers: useRequestHeaders(['cookie']),
  immediate: shouldFetchInitial,
  watch: false,
  query: bookQuery
})

watch(data, (response) => {
  if (!response) return

  const responseIds = new Set(response.items.map(book => book.id))
  const pending = getPendingAddedBooks().filter(book => !responseIds.has(book.id) && pendingBookMatchesFilters(book))
  clearPendingAddedBooks(response.items.map(book => book.id))
  const items = [...pending, ...response.items]

  paginationState.value = pending.length > 0
    ? {
        ...response.pagination,
        totalItems: response.pagination.totalItems + pending.length,
        totalPages: response.pagination.perShelf ? response.pagination.totalPages : Math.ceil((response.pagination.totalItems + pending.length) / response.pagination.pageSize),
        hasMore: response.pagination.perShelf ? response.pagination.hasMore : response.pagination.page < Math.ceil((response.pagination.totalItems + pending.length) / response.pagination.pageSize)
      }
    : response.pagination

  if (page.value === 1) {
    allBooks.value = items
  } else {
    const existingIds = new Set(allBooks.value.map(book => book.id))
    const newItems = items.filter(book => !existingIds.has(book.id))
    allBooks.value.push(...newItems)
  }
  applyPendingEnrichmentUpdates()

  cacheResultsAction(activeResultCacheKey.value)
}, { immediate: shouldFetchInitial })

const hasPendingEnrichment = computed(() =>
  allBooks.value.some(book =>
    book.enrichmentStatus === 'queued'
    || book.enrichmentStatus === 'preparing'
    || book.enrichmentStatus === 'retrying'
  )
)

function scheduleEnrichmentPoll(delayOverride?: number) {
  if (!import.meta.client || !isEnrichmentPollActive.value || enrichmentPollTimer.value || !hasPendingEnrichment.value) return

  const delay = delayOverride ?? Math.min(60_000, 5000 * 2 ** enrichmentPollFailures.value)

  enrichmentPollTimer.value = setTimeout(async () => {
    enrichmentPollTimer.value = null
    try {
      const pendingIds = allBooks.value
        .filter(book =>
          book.enrichmentStatus === 'queued'
          || book.enrichmentStatus === 'preparing'
          || book.enrichmentStatus === 'retrying'
        )
        .map(book => book.id)
      for (let offset = 0; offset < pendingIds.length; offset += 100) {
        const updates = await $fetch<LibraryBookEnrichmentUpdate[]>('/api/books/enrichment/updates', {
          method: 'POST',
          body: { ids: pendingIds.slice(offset, offset + 100) }
        })
        for (const update of updates) {
          updateBookEnrichment(update.userBookId, update)
        }
      }
      cacheResultsAction(activeResultCacheKey.value)
      enrichmentPollFailures.value = 0
    } catch (error) {
      enrichmentPollFailures.value = Math.min(enrichmentPollFailures.value + 1, 4)
      console.error('Failed to refresh book enrichment status', error)
    } finally {
      scheduleEnrichmentPoll()
    }
  }, delay)
}

watch(hasPendingEnrichment, (pending) => {
  if (pending) {
    scheduleEnrichmentPoll()
  } else {
    enrichmentPollFailures.value = 0
    if (enrichmentPollTimer.value) {
      clearTimeout(enrichmentPollTimer.value)
      enrichmentPollTimer.value = null
    }
  }
}, { immediate: true })

function handleVisibilityChange() {
  isEnrichmentPollActive.value = !document.hidden
  if (isEnrichmentPollActive.value) {
    enrichmentPollFailures.value = 0
    scheduleEnrichmentPoll(0)
  } else if (enrichmentPollTimer.value) {
    clearTimeout(enrichmentPollTimer.value)
    enrichmentPollTimer.value = null
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  handleVisibilityChange()

  const syncAndRestore = async () => {
    try {
      if (shouldSync.value) {
        await syncLoadedPages(syncTargetPages.value)

        clearNeedsSyncAction()
      }
    } catch (err: unknown) {
      const message = err instanceof Error
        ? err.message
        : (err as { data?: { message?: string } })?.data?.message || 'Unable to refresh your library'

      console.error('Failed to sync library pages during mount', err)
      toast.add({
        title: 'Could not refresh library',
        description: message,
        color: 'error'
      })
    } finally {
      if (shouldRestoreScroll.value) {
        nextTick(() => {
          requestAnimationFrame(() => {
            window.scrollTo({ top: scrollY.value, behavior: 'auto' })
            shouldRestoreScroll.value = false
          })
        })
      }
    }
  }

  void syncAndRestore()
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (filterRefreshTimer.value) clearTimeout(filterRefreshTimer.value)
  if (preferenceSaveTimer.value) clearTimeout(preferenceSaveTimer.value)
  isEnrichmentPollActive.value = false
  if (enrichmentPollTimer.value) {
    clearTimeout(enrichmentPollTimer.value)
    enrichmentPollTimer.value = null
  }
})

onBeforeRouteLeave((to) => {
  const isOpeningBookDetails = /^\/library\/(?!add$)[^/]+$/.test(to.path)

  if (isOpeningBookDetails) {
    scrollY.value = window.scrollY
    shouldRestoreScroll.value = true
    return
  }

  scrollY.value = 0
  shouldRestoreScroll.value = false
})

// Computed values
const books = computed(() => allBooks.value)
const pagination = computed(() => paginationState.value)
const hasBooks = computed(() => books.value.length > 0 || (useShelfPagination.value && (pagination.value?.totalItems ?? 0) > 0))
const isDefaultLibraryState = computed(() =>
  libraryState.value.length === DEFAULT_LIBRARY_STATE_FILTER.length
  && libraryState.value.every(state => DEFAULT_LIBRARY_STATE_FILTER.includes(state))
)
const hasNonDefaultLibraryView = computed(() =>
  !isDefaultLibraryState.value && hasLibraryStateFilter(libraryState.value)
)
const hasActiveFilters = computed(() =>
  Boolean(search.value.trim())
  || (showPhysicalFilters.value && loanStatus.value !== 'all')
  || (showPhysicalFilters.value && readingStatus.value !== 'all')
  || tags.value.length > 0
  || (showPhysicalFilters.value && Boolean(location.value.trim()))
  || (showPhysicalFilters.value && Boolean(locationId.value))
  || (showPhysicalFilters.value && includeLocationDescendants.value)
  || sortBy.value !== 'dateAdded'
)
const activeAdvancedFilterCount = computed(() => getActiveLibraryFilterCount({
  libraryState: [],
  loanStatus: showPhysicalFilters.value ? loanStatus.value : 'all',
  readingStatus: showPhysicalFilters.value ? readingStatus.value : 'all',
  tags: tags.value,
  location: showPhysicalFilters.value ? location.value : undefined,
  locationId: showPhysicalFilters.value ? locationId.value : undefined,
  includeLocationDescendants: showPhysicalFilters.value ? includeLocationDescendants.value : false,
  sortBy: sortBy.value,
  groupByLocation: showPhysicalFilters.value ? groupByLocation.value : false
}))
const hasActiveAdvancedFilters = computed(() => activeAdvancedFilterCount.value > 0)
const loanStatusItems = [
  { label: 'All loans', value: 'all' },
  { label: 'Available', value: 'available' },
  { label: 'Loaned out', value: 'loaned' }
]
const libraryStateFilterLabel = computed(() => {
  const selectedStates = libraryState.value
  const hasAllStates = libraryStateFilterValues.every(state => selectedStates.includes(state))

  if (selectedStates.length === 0 || hasAllStates) return 'All books'

  return selectedStates.map(state => libraryStateLabels[state]).join(', ')
})
const readingStatusItems = [
  { label: 'All reading', value: 'all' },
  { label: 'Unread', value: 'unread' },
  { label: 'Reading', value: 'reading' },
  { label: 'Read', value: 'read' }
]
const physicalSortItem = { label: 'Location path', value: 'locationPath' }
const sortItems = computed(() => [
  { label: 'Date added', value: 'dateAdded' },
  ...(showPhysicalFilters.value ? [physicalSortItem] : []),
  { label: 'Title', value: 'title' },
  { label: 'Author', value: 'author' }
])
const selectedLocationFilter = computed({
  get: () => locationId.value || ALL_LOCATIONS_VALUE,
  set: (value: string) => {
    locationId.value = value === ALL_LOCATIONS_VALUE ? '' : value
  }
})
const locationOptions = computed(() => [
  { label: 'All locations', value: ALL_LOCATIONS_VALUE },
  ...(locations.value ?? []).map(location => ({
    label: location.path,
    value: location.id
  }))
])
const tagOptions = computed(() => (availableTags.value ?? []).map(tag => ({
  label: `${tag.name} (${tag.bookCount})`,
  value: tag.name.toLowerCase()
})))
const selectedLocationLabel = computed(() =>
  locationOptions.value.find(option => option.value === selectedLocationFilter.value)?.label
)
const activeFilterSummary = computed(() => describeActiveLibraryFilters({
  libraryState: [],
  loanStatus: showPhysicalFilters.value ? loanStatus.value : 'all',
  readingStatus: showPhysicalFilters.value ? readingStatus.value : 'all',
  tags: tags.value,
  location: showPhysicalFilters.value ? location.value : undefined,
  locationId: showPhysicalFilters.value ? locationId.value : undefined,
  includeLocationDescendants: showPhysicalFilters.value ? includeLocationDescendants.value : false,
  sortBy: sortBy.value,
  groupByLocation: showPhysicalFilters.value ? groupByLocation.value : false
}, {
  locationLabel: selectedLocationLabel.value
}))
const collapsedFilterSummary = computed(() => activeFilterSummary.value.slice(0, 3))
const groupedBooks = computed(() => {
  const groups = new Map<string, { key: string, label: string, books: LibraryBook[] }>()

  if (useShelfPagination.value && pagination.value?.shelfLabels) {
    for (const key of Object.keys(pagination.value.shelfCounts ?? {})) {
      const label = pagination.value?.shelfLabels?.[key] ?? 'No location'
      groups.set(key, { key, label, books: [] })
    }
  }

  for (const book of books.value) {
    const key = book.location?.id ?? 'none'
    const label = book.location?.path ?? 'No location'
    const group = groups.get(key) ?? { key, label, books: [] }
    group.books.push(book)
    groups.set(key, group)
  }

  return [...groups.values()].sort((a, b) => {
    if (a.key === 'none') return 1
    if (b.key === 'none') return -1
    return a.label.localeCompare(b.label)
  })
})

watch([search, loanStatus, libraryState, readingStatus, tags, location, locationId, includeLocationDescendants, sortBy, useShelfPagination], () => {
  if (suppressFilterWatcher.value || !authStore.isAuthenticated) return
  isApplyingFilters.value = true
  if (filterRefreshTimer.value) clearTimeout(filterRefreshTimer.value)

  const nextCacheKey = getLibraryResultCacheKey()
  if (nextCacheKey !== activeResultCacheKey.value) {
    cacheResultsAction(activeResultCacheKey.value)
    const cached = restoreCachedResultsAction(nextCacheKey)
    if (cached) {
      activeResultCacheKey.value = nextCacheKey
    }
  }

  filterRefreshTimer.value = setTimeout(() => {
    void applyFilters()
  }, 250)
})

function markLibraryStatePreferenceAsUserSelected() {
  shouldPersistLibraryStatePreference.value = true
}

watch(libraryState, (nextState) => {
  if (!shouldPersistLibraryStatePreference.value) return

  if (preferenceSaveTimer.value) clearTimeout(preferenceSaveTimer.value)
  preferenceSaveTimer.value = setTimeout(() => {
    void $fetch('/api/preferences', {
      method: 'PUT',
      body: {
        defaultLibraryStateFilter: nextState
      }
    }).catch((err: unknown) => {
      console.error('Failed to save library state preference', err)
    })
  }, 500)

  if (nextState.length === 0 || nextState.includes('owned')) return

  loanStatus.value = 'all'
  readingStatus.value = 'all'
  location.value = ''
  locationId.value = ''
  includeLocationDescendants.value = false
  groupByLocation.value = false
  if (sortBy.value === 'locationPath') {
    sortBy.value = 'dateAdded'
  }
}, { flush: 'post' })

watch(locationId, (nextLocationId) => {
  if (!nextLocationId) {
    includeLocationDescendants.value = false
  }
})

function toggleTagFilter(tag: string) {
  const normalizedTag = tag.trim().toLowerCase()
  const existingIndex = tags.value.findIndex(selected => selected.toLowerCase() === normalizedTag)
  tags.value = existingIndex === -1
    ? [...tags.value, normalizedTag]
    : tags.value.filter((_, index) => index !== existingIndex)
}

async function applyFilters() {
  if (!authStore.isAuthenticated) return

  isApplyingFilters.value = true
  cacheResultsAction(activeResultCacheKey.value)
  const nextCacheKey = getLibraryResultCacheKey()
  const cached = restoreCachedResultsAction(nextCacheKey)
  const targetPages = cached?.loadedPage ?? 1

  activeResultCacheKey.value = nextCacheKey

  updateBrowserQuery({
    page: 1,
    pageSize: pageSize.value,
    search: search.value.trim() || undefined,
    libraryState: libraryState.value,
    loanStatus: showPhysicalFilters.value ? loanStatus.value : 'all',
    readingStatus: showPhysicalFilters.value ? readingStatus.value : 'all',
    tags: tags.value,
    location: showPhysicalFilters.value ? location.value.trim() || undefined : undefined,
    locationId: showPhysicalFilters.value ? locationId.value || undefined : undefined,
    includeLocationDescendants: showPhysicalFilters.value ? includeLocationDescendants.value : false,
    sortBy: sortBy.value
  })

  page.value = 1
  try {
    await syncLoadedPages(targetPages)
  } finally {
    isApplyingFilters.value = false
  }
}

function updateBrowserQuery(state: Parameters<typeof buildLibraryRouteQuery>[0]) {
  if (!import.meta.client) return

  const params = new URLSearchParams(buildLibraryRouteQuery(state))
  const queryString = params.toString()
  const nextUrl = queryString ? `${route.path}?${queryString}` : route.path

  window.history.replaceState(window.history.state, '', nextUrl)
}

async function clearFilters() {
  isApplyingFilters.value = true
  suppressFilterWatcher.value = true
  if (filterRefreshTimer.value) {
    clearTimeout(filterRefreshTimer.value)
    filterRefreshTimer.value = null
  }

  search.value = ''
  loanStatus.value = 'all'
  readingStatus.value = 'all'
  tags.value = []
  location.value = ''
  locationId.value = ''
  includeLocationDescendants.value = false
  sortBy.value = 'dateAdded'
  groupByLocation.value = false

  await nextTick()
  suppressFilterWatcher.value = false
  try {
    await applyFilters()
  } finally {
    isApplyingFilters.value = false
  }
}

const shelfRequests = reactive(new Map<string, AbortController>())
const shelfHasMore = (group: { key: string, books: LibraryBook[] }) =>
  group.books.length < (pagination.value?.shelfCounts?.[group.key] ?? 0)

function resetShelfRequests() {
  for (const controller of shelfRequests.values()) controller.abort()
  shelfRequests.clear()
}
watch([layout, activeResultCacheKey, isApplyingFilters], resetShelfRequests)
onBeforeUnmount(resetShelfRequests)

async function loadShelf(group: { key: string, books: LibraryBook[] }) {
  if (!useShelfPagination.value || isApplyingFilters.value || status.value === 'pending' || shelfRequests.has(group.key) || !shelfHasMore(group)) return
  const currentPagination = paginationState.value
  if (!currentPagination) return
  const nextPage = currentPagination.shelfNextPages?.[group.key]
    ?? (currentPagination.shelfLabels ? 1 : Math.floor(group.books.length / pageSize.value) + 1)
  const controller = new AbortController()
  shelfRequests.set(group.key, controller)
  try {
    const result = await $fetch<PaginatedResponse>('/api/books', {
      query: { ...bookQuery.value, layout: 'shelves', shelf: group.key, page: nextPage },
      signal: controller.signal
    })
    if (controller.signal.aborted || paginationState.value !== currentPagination) return
    const existingIds = new Set(allBooks.value.map(book => book.id))
    const added = result.items.filter(book => !existingIds.has(book.id))
    allBooks.value.push(...added)
    currentPagination.shelfNextPages ??= {}
    currentPagination.shelfNextPages[group.key] = nextPage + 1
    if (currentPagination.shelfCounts) {
      currentPagination.shelfCounts[group.key] = result.pagination.hasMore
        ? result.pagination.totalItems
        : group.books.length + added.length
    }
    applyPendingEnrichmentUpdates()
    cacheResultsAction(activeResultCacheKey.value)
  } catch {
    if (!controller.signal.aborted) {
      toast.add({ title: 'Unable to load more books', description: 'Use the shelf arrow to try again.', color: 'error' })
    }
  } finally {
    if (shelfRequests.get(group.key) === controller) shelfRequests.delete(group.key)
  }
}
async function loadMore() {
  if (useShelfPagination.value || !pagination.value?.hasMore || isLoadingMore.value || isApplyingFilters.value || status.value === 'pending') return
  isLoadingMore.value = true
  const previousPage = page.value
  try {
    page.value++
    await refresh()
    if (libraryFetchError.value) throw libraryFetchError.value
  } catch {
    page.value = previousPage
    toast.add({ title: 'Unable to load more books', color: 'error' })
  } finally {
    isLoadingMore.value = false
  }
}

async function syncLoadedPages(targetPages: number) {
  const normalizedTargetPages = Math.max(1, targetPages)
  const previousAllBooks = [...allBooks.value]
  const previousPage = page.value

  try {
    page.value = 1
    await refresh()
    if (libraryFetchError.value) throw libraryFetchError.value

    if (useShelfPagination.value) return
    for (let currentPage = 2; currentPage <= normalizedTargetPages; currentPage++) {
      if (!paginationState.value?.hasMore) break
      page.value = currentPage
      await refresh()
    }
  } catch (error) {
    allBooks.value = previousAllBooks
    page.value = previousPage
    throw error
  }
}
</script>

<template>
  <UContainer>
    <!-- Page Header -->
    <UPageHeader
      title="My Library"
      :description="pagination ? `${pagination.totalItems} ${pagination.totalItems === 1 ? 'book' : 'books'}` : undefined"
    >
      <template #links>
        <UButton
          icon="i-lucide-map"
          size="lg"
          color="neutral"
          variant="outline"
          to="/library/locations"
          aria-label="Locations"
          title="Locations"
        >
          <span class="hidden sm:inline">Locations</span>
        </UButton>
        <UButton
          icon="i-lucide-plus"
          size="lg"
          to="/library/add"
        >
          Add Book
        </UButton>
      </template>
    </UPageHeader>

    <!-- Page Body -->
    <UPageBody>
      <div class="flex justify-end">
        <div
          class="flex gap-1 rounded-xl border border-default bg-muted/50 p-1"
          role="group"
          aria-label="Library layout"
        >
          <UButton
            icon="i-lucide-panels-top-left"
            size="sm"
            :color="useShelfPagination ? 'primary' : 'neutral'"
            :variant="useShelfPagination ? 'solid' : 'ghost'"
            class="rounded-lg"
            :aria-pressed="useShelfPagination"
            :disabled="!!search.trim()"
            @click="layout = 'shelves'"
          >
            Shelves
          </UButton>
          <UButton
            icon="i-lucide-layout-grid"
            size="sm"
            :color="!useShelfPagination ? 'primary' : 'neutral'"
            :variant="!useShelfPagination ? 'solid' : 'ghost'"
            class="rounded-lg"
            :aria-pressed="!useShelfPagination"
            @click="layout = 'grid'"
          >
            Grid
          </UButton>
        </div>
      </div>

      <section
        class="rounded-2xl border border-default bg-elevated/40 p-4 sm:p-5"
        aria-label="Find books"
      >
        <div class="grid grid-cols-[minmax(0,1fr)_auto] gap-3 md:flex md:items-center">
          <div class="contents md:flex md:flex-1 md:items-center md:gap-2">
            <UInput
              v-model="search"
              icon="i-lucide-search"
              size="lg"
              aria-label="Search library"
              placeholder="Search title, author, ISBN, tag, or location"
              class="col-span-2 w-full md:flex-1"
            />
            <USelectMenu
              v-model="libraryState"
              :items="libraryStateFilterItems"
              multiple
              value-key="value"
              icon="i-lucide-bookmark"
              size="lg"
              aria-label="Library state"
              class="w-full md:w-42"
              @update:model-value="markLibraryStatePreferenceAsUserSelected"
            >
              <template #default>
                <span class="truncate">{{ libraryStateFilterLabel }}</span>
              </template>
            </USelectMenu>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <UButton
              size="lg"
              color="neutral"
              variant="outline"
              icon="i-lucide-sliders-horizontal"
              :trailing-icon="areFiltersExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :aria-expanded="areFiltersExpanded"
              :aria-controls="areFiltersExpanded ? 'library-advanced-filters' : undefined"
              class="justify-center"
              @click="() => { areFiltersExpanded = !areFiltersExpanded }"
            >
              Filters
              <UBadge
                v-if="hasActiveAdvancedFilters"
                color="primary"
                variant="soft"
                size="sm"
                class="ml-1"
              >
                {{ activeAdvancedFilterCount }}
              </UBadge>
            </UButton>
            <UButton
              v-if="hasActiveFilters || groupByLocation"
              size="lg"
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              class="flex-1 justify-center md:flex-none"
              @click="clearFilters"
            >
              Clear
            </UButton>
          </div>
        </div>

        <div
          v-if="hasActiveAdvancedFilters && !areFiltersExpanded"
          class="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted"
        >
          <span>Active:</span>
          <UBadge
            v-for="summary in collapsedFilterSummary"
            :key="summary"
            color="neutral"
            variant="soft"
          >
            {{ summary }}
          </UBadge>
          <span v-if="activeFilterSummary.length > collapsedFilterSummary.length">
            +{{ activeFilterSummary.length - collapsedFilterSummary.length }} more
          </span>
        </div>

        <UCollapsible
          v-model:open="areFiltersExpanded"
          :unmount-on-hide="false"
        >
          <template #content>
            <div
              id="library-advanced-filters"
              class="mt-3 space-y-3 rounded-lg border border-default bg-muted/30 p-3"
            >
              <div
                class="grid gap-3"
                :class="showPhysicalFilters ? 'md:grid-cols-4' : 'md:grid-cols-2'"
              >
                <USelect
                  v-if="showPhysicalFilters"
                  v-model="loanStatus"
                  :items="loanStatusItems"
                  aria-label="Loan status"
                  class="w-full"
                />
                <USelect
                  v-if="showPhysicalFilters"
                  v-model="readingStatus"
                  :items="readingStatusItems"
                  aria-label="Reading status"
                  class="w-full"
                />
                <USelectMenu
                  v-model="tags"
                  :items="tagOptions"
                  multiple
                  searchable
                  value-key="value"
                  icon="i-lucide-tag"
                  aria-label="Filter by tag"
                  placeholder="Filter tags"
                  class="w-full"
                />
                <UInput
                  v-if="showPhysicalFilters"
                  v-model="location"
                  icon="i-lucide-map-pin"
                  aria-label="Filter by location path"
                  placeholder="Search location path"
                />
                <USelect
                  v-if="!showPhysicalFilters"
                  v-model="sortBy"
                  :items="sortItems"
                  icon="i-lucide-arrow-up-down"
                  aria-label="Sort library"
                  class="w-full"
                />
              </div>

              <div
                v-if="showPhysicalFilters"
                class="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto] md:items-center"
              >
                <USelect
                  v-model="selectedLocationFilter"
                  :items="locationOptions"
                  icon="i-lucide-map-pin"
                  aria-label="Location filter mode"
                  class="w-full"
                />
                <USelect
                  v-model="sortBy"
                  :items="sortItems"
                  icon="i-lucide-arrow-up-down"
                  aria-label="Sort library"
                  class="w-full"
                />
                <UCheckbox
                  v-model="includeLocationDescendants"
                  :disabled="!locationId"
                  aria-label="Include sub-locations"
                  label="Include sub-locations"
                />
                <USwitch
                  v-if="!useShelfPagination"
                  v-model="groupByLocation"
                  aria-label="Group by location"
                  label="Group by location"
                />
              </div>
            </div>
          </template>
        </UCollapsible>
      </section>

      <!-- Loading State -->
      <div
        v-if="(status === 'pending' || isApplyingFilters) && !hasBooks"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <!-- Empty State -->
      <UCard
        v-else-if="!hasBooks && !hasActiveFilters && !hasNonDefaultLibraryView"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-book-open"
          class="text-6xl text-muted mx-auto mb-4"
        />
        <h2 class="text-xl font-semibold mb-2">
          Your library is empty
        </h2>
        <p class="text-muted mb-6">
          Start by adding your first book.
        </p>
        <UButton
          icon="i-lucide-plus"
          size="lg"
          to="/library/add"
        >
          Add First Book
        </UButton>
      </UCard>

      <UCard
        v-else-if="!hasBooks"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-search-x"
          class="text-6xl text-muted mx-auto mb-4"
        />
        <h2 class="text-xl font-semibold mb-2">
          {{ hasNonDefaultLibraryView && !hasActiveFilters ? 'No books in this view' : 'No books found' }}
        </h2>
        <p class="text-muted mb-6">
          {{ hasNonDefaultLibraryView && !hasActiveFilters
            ? 'Choose another view to see a different set of books.'
            : 'Try a different title, author, ISBN, tag, or shelf location.' }}
        </p>
        <UButton
          v-if="hasActiveFilters"
          color="neutral"
          variant="outline"
          icon="i-lucide-x"
          @click="clearFilters"
        >
          Clear filters
        </UButton>
      </UCard>

      <!-- Shelves and grid -->
      <template v-else>
        <div
          v-if="useShelfPagination"
          class="space-y-10 pt-2"
        >
          <BookShelf
            v-for="group in groupedBooks"
            :key="group.key"
            :title="group.label"
            :books="group.books"
            :total="pagination?.shelfCounts?.[group.key] ?? group.books.length"
            :can-load="!isApplyingFilters && status !== 'pending'"
            :has-more="shelfHasMore(group)"
            :loading="shelfRequests.has(group.key)"
            @load-more="loadShelf(group)"
            @tag="toggleTagFilter"
          />
        </div>
        <div
          v-else-if="groupByLocation"
          class="space-y-8"
        >
          <section
            v-for="group in groupedBooks"
            :key="group.key"
            class="space-y-3"
          >
            <div class="flex items-center justify-between gap-3 border-b border-default pb-2">
              <h2 class="text-base font-semibold text-highlighted">
                {{ group.label }}
              </h2>
              <span class="text-sm text-muted">
                {{ group.books.length }} {{ group.books.length === 1 ? 'book' : 'books' }}
              </span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <BookCard
                v-for="book in group.books"
                :id="book.id"
                :key="book.id"
                :book-id="book.bookId"
                :title="book.title"
                :author="book.author"
                :isbn="book.isbn"
                :cover-path="book.coverPath"
                :location="book.location"
                :last-known-location="book.lastKnownLocation"
                :added-at="book.addedAt"
                :active-loan="book.activeLoan"
                :library-state="book.libraryState"
                :tags="book.tags"
                :enrichment-status="book.enrichmentStatus"
                @tag-selected="toggleTagFilter"
              />
            </div>
          </section>
        </div>

        <div
          v-else
          class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4"
        >
          <BookCard
            v-for="book in books"
            :id="book.id"
            :key="book.id"
            :book-id="book.bookId"
            :title="book.title"
            :author="book.author"
            :isbn="book.isbn"
            :cover-path="book.coverPath"
            :location="book.location"
            :last-known-location="book.lastKnownLocation"
            :added-at="book.addedAt"
            :active-loan="book.activeLoan"
            :library-state="book.libraryState"
            :tags="book.tags"
            :enrichment-status="book.enrichmentStatus"
            @tag-selected="toggleTagFilter"
          />
        </div>

        <!-- Load More -->
        <div
          v-if="!useShelfPagination && pagination?.hasMore"
          class="mt-8 text-center"
        >
          <UButton
            color="neutral"
            variant="outline"
            :loading="isLoadingMore"
            :disabled="isLoadingMore || isApplyingFilters || status === 'pending'"
            @click="loadMore"
          >
            Load More
          </UButton>
        </div>

        <!-- Pagination Info -->
        <div
          v-if="pagination"
          class="mt-4 text-center text-sm text-muted"
        >
          Showing {{ books.length }} of {{ pagination.totalItems }} books
        </div>
      </template>
    </UPageBody>
  </UContainer>
</template>
