<script setup lang="ts">
import type { LibraryBook, BookLocationWithCount } from '~~/shared/types/book'
import {
  buildLibraryRouteQuery,
  DEFAULT_LIBRARY_STATE_FILTER,
  describeActiveLibraryFilters,
  getActiveLibraryFilterCount,
  normalizeLibraryQuery
} from '~~/shared/utils/library-query'

interface PaginatedResponse {
  items: LibraryBook[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
    hasMore: boolean
  }
}

usePageTitle('Library')

const toast = useToast()
const route = useRoute()

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
  tag,
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

const {
  clearNeedsSync: clearNeedsSyncAction,
  resetResults: resetResultsAction
} = dashboardStore

const routeState = normalizeLibraryQuery(route.query)
const hasRouteStateMismatch = pageSize.value !== routeState.pageSize
  || search.value !== (routeState.search ?? '')
  || loanStatus.value !== (routeState.loanStatus ?? 'all')
  || libraryState.value !== (routeState.libraryState ?? DEFAULT_LIBRARY_STATE_FILTER)
  || readingStatus.value !== (routeState.readingStatus ?? 'all')
  || tag.value !== (routeState.tag ?? '')
  || location.value !== (routeState.location ?? '')
  || locationId.value !== (routeState.locationId ?? '')
  || includeLocationDescendants.value !== Boolean(routeState.includeLocationDescendants)
  || sortBy.value !== (routeState.sortBy ?? 'dateAdded')
const hasCachedResults = allBooks.value.length > 0 && paginationState.value

if (hasRouteStateMismatch) {
  resetResultsAction()
}

if (hasRouteStateMismatch || !hasCachedResults) {
  page.value = routeState.page
}
pageSize.value = routeState.pageSize
search.value = routeState.search ?? ''
loanStatus.value = routeState.loanStatus ?? 'all'
libraryState.value = routeState.libraryState ?? DEFAULT_LIBRARY_STATE_FILTER
readingStatus.value = routeState.readingStatus ?? 'all'
tag.value = routeState.tag ?? ''
location.value = routeState.location ?? ''
locationId.value = routeState.locationId ?? ''
includeLocationDescendants.value = Boolean(routeState.includeLocationDescendants)
sortBy.value = routeState.sortBy ?? 'dateAdded'

// Pagination state
const isLoadingMore = ref(false)
const filterRefreshTimer = ref<ReturnType<typeof setTimeout> | null>(null)
const ALL_LOCATIONS_VALUE = '__all_locations__'
const areFiltersExpanded = ref(false)

const shouldFetchInitial = allBooks.value.length === 0 || !paginationState.value
const showPhysicalFilters = computed(() => libraryState.value !== 'wishlisted')

const { data: locations } = await useFetch<BookLocationWithCount[]>('/api/locations', {
  headers: useRequestHeaders(['cookie'])
})

// Fetch books with pagination
const { data, refresh, status } = await useFetch<PaginatedResponse>('/api/books', {
  headers: useRequestHeaders(['cookie']),
  immediate: shouldFetchInitial,
  watch: false,
  query: computed(() => ({
    page: page.value,
    pageSize: pageSize.value,
    search: search.value || undefined,
    libraryState: libraryState.value === DEFAULT_LIBRARY_STATE_FILTER ? undefined : libraryState.value,
    loanStatus: showPhysicalFilters.value && loanStatus.value !== 'all' ? loanStatus.value : undefined,
    readingStatus: showPhysicalFilters.value && readingStatus.value !== 'all' ? readingStatus.value : undefined,
    tag: tag.value || undefined,
    location: showPhysicalFilters.value ? location.value || undefined : undefined,
    locationId: showPhysicalFilters.value ? locationId.value || undefined : undefined,
    includeLocationDescendants: showPhysicalFilters.value ? includeLocationDescendants.value || undefined : undefined,
    sortBy: sortBy.value === 'dateAdded' ? undefined : sortBy.value
  }))
})

watch(data, (response) => {
  if (!response) return

  paginationState.value = response.pagination

  if (page.value === 1) {
    allBooks.value = [...response.items]
  } else {
    const existingIds = new Set(allBooks.value.map(book => book.id))
    const newItems = response.items.filter(book => !existingIds.has(book.id))
    allBooks.value.push(...newItems)
  }
}, { immediate: true })

onMounted(() => {
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
  if (filterRefreshTimer.value) clearTimeout(filterRefreshTimer.value)
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
const hasBooks = computed(() => books.value.length > 0)
const hasActiveFilters = computed(() =>
  Boolean(search.value.trim())
  || libraryState.value !== DEFAULT_LIBRARY_STATE_FILTER
  || (showPhysicalFilters.value && loanStatus.value !== 'all')
  || (showPhysicalFilters.value && readingStatus.value !== 'all')
  || Boolean(tag.value.trim())
  || (showPhysicalFilters.value && Boolean(location.value.trim()))
  || (showPhysicalFilters.value && Boolean(locationId.value))
  || (showPhysicalFilters.value && includeLocationDescendants.value)
  || sortBy.value !== 'dateAdded'
)
const activeAdvancedFilterCount = computed(() => getActiveLibraryFilterCount({
  libraryState: libraryState.value,
  loanStatus: showPhysicalFilters.value ? loanStatus.value : 'all',
  readingStatus: showPhysicalFilters.value ? readingStatus.value : 'all',
  tag: tag.value,
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
const libraryStateFilterItems = [
  { label: 'All books', value: 'all' },
  ...libraryStateItems
]
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
const selectedLocationLabel = computed(() =>
  locationOptions.value.find(option => option.value === selectedLocationFilter.value)?.label
)
const activeFilterSummary = computed(() => describeActiveLibraryFilters({
  libraryState: libraryState.value,
  loanStatus: showPhysicalFilters.value ? loanStatus.value : 'all',
  readingStatus: showPhysicalFilters.value ? readingStatus.value : 'all',
  tag: tag.value,
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

watch([search, loanStatus, libraryState, readingStatus, tag, location, locationId, includeLocationDescendants, sortBy], () => {
  if (filterRefreshTimer.value) clearTimeout(filterRefreshTimer.value)

  filterRefreshTimer.value = setTimeout(() => {
    void applyFilters()
  }, 250)
})

watch(libraryState, (nextState) => {
  if (nextState !== 'wishlisted') return

  loanStatus.value = 'all'
  readingStatus.value = 'all'
  location.value = ''
  locationId.value = ''
  includeLocationDescendants.value = false
  groupByLocation.value = false
  if (sortBy.value === 'locationPath') {
    sortBy.value = 'dateAdded'
  }
})

watch(locationId, (nextLocationId) => {
  if (!nextLocationId) {
    includeLocationDescendants.value = false
  }
})

async function applyFilters() {
  updateBrowserQuery({
    page: 1,
    pageSize: pageSize.value,
    search: search.value.trim() || undefined,
    libraryState: libraryState.value,
    loanStatus: showPhysicalFilters.value ? loanStatus.value : 'all',
    readingStatus: showPhysicalFilters.value ? readingStatus.value : 'all',
    tag: tag.value.trim() || undefined,
    location: showPhysicalFilters.value ? location.value.trim() || undefined : undefined,
    locationId: showPhysicalFilters.value ? locationId.value || undefined : undefined,
    includeLocationDescendants: showPhysicalFilters.value ? includeLocationDescendants.value : false,
    sortBy: sortBy.value
  })

  page.value = 1
  await refresh()
}

function updateBrowserQuery(state: Parameters<typeof buildLibraryRouteQuery>[0]) {
  if (!import.meta.client) return

  const params = new URLSearchParams(buildLibraryRouteQuery(state))
  const queryString = params.toString()
  const nextUrl = queryString ? `${route.path}?${queryString}` : route.path

  window.history.replaceState(window.history.state, '', nextUrl)
}

function clearFilters() {
  search.value = ''
  loanStatus.value = 'all'
  libraryState.value = DEFAULT_LIBRARY_STATE_FILTER
  readingStatus.value = 'all'
  tag.value = ''
  location.value = ''
  locationId.value = ''
  includeLocationDescendants.value = false
  sortBy.value = 'dateAdded'
  groupByLocation.value = false
}

// Load more
async function loadMore() {
  if (pagination.value?.hasMore && !isLoadingMore.value) {
    isLoadingMore.value = true
    try {
      page.value++
      await refresh()
    } finally {
      isLoadingMore.value = false
    }
  }
}

async function syncLoadedPages(targetPages: number) {
  const normalizedTargetPages = Math.max(1, targetPages)
  const previousAllBooks = [...allBooks.value]
  const previousPage = page.value

  try {
    page.value = 1
    await refresh()

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
        >
          Locations
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
      <section class="mb-6">
        <div class="flex flex-col gap-3 md:flex-row md:items-center">
          <div class="grid w-full gap-2 md:flex md:flex-1 md:items-center">
            <UInput
              v-model="search"
              icon="i-lucide-search"
              size="lg"
              aria-label="Search library"
              placeholder="Search title, author, ISBN, tag, or location"
              class="w-full md:flex-1"
            />
            <USelect
              v-model="libraryState"
              :items="libraryStateFilterItems"
              icon="i-lucide-bookmark"
              size="lg"
              aria-label="Library state"
              class="w-full md:w-42"
            />
          </div>

          <div class="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <UButton
              size="lg"
              color="neutral"
              variant="outline"
              icon="i-lucide-sliders-horizontal"
              :trailing-icon="areFiltersExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :aria-expanded="areFiltersExpanded"
              :aria-controls="areFiltersExpanded ? 'library-advanced-filters' : undefined"
              class="w-full justify-center md:w-auto"
              @click="areFiltersExpanded = !areFiltersExpanded"
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
                :class="showPhysicalFilters ? 'md:grid-cols-4' : 'md:grid-cols-1'"
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
                <UInput
                  v-model="tag"
                  icon="i-lucide-tag"
                  aria-label="Filter by tag"
                  placeholder="Filter tag"
                />
                <UInput
                  v-if="showPhysicalFilters"
                  v-model="location"
                  icon="i-lucide-map-pin"
                  aria-label="Filter by location path"
                  placeholder="Search location path"
                />
              </div>

              <div
                class="grid gap-3 md:items-center"
                :class="showPhysicalFilters ? 'md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto]' : 'md:grid-cols-[minmax(0,1fr)]'"
              >
                <USelect
                  v-if="showPhysicalFilters"
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
                  v-if="showPhysicalFilters"
                  v-model="includeLocationDescendants"
                  :disabled="!locationId"
                  aria-label="Include sub-locations"
                  label="Include sub-locations"
                />
                <USwitch
                  v-if="showPhysicalFilters"
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
        v-if="status === 'pending' && !hasBooks"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <!-- Empty State -->
      <UCard
        v-else-if="!hasBooks && !hasActiveFilters"
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
          No books found
        </h2>
        <p class="text-muted mb-6">
          Try a different title, author, ISBN, tag, or shelf location.
        </p>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-x"
          @click="clearFilters"
        >
          Clear filters
        </UButton>
      </UCard>

      <!-- Book Grid -->
      <template v-else>
        <div
          v-if="groupByLocation"
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
                :added-at="book.addedAt"
                :active-loan="book.activeLoan"
                :library-state="book.libraryState"
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
            :added-at="book.addedAt"
            :active-loan="book.activeLoan"
            :library-state="book.libraryState"
          />
        </div>

        <!-- Load More -->
        <div
          v-if="pagination?.hasMore"
          class="mt-8 text-center"
        >
          <UButton
            color="neutral"
            variant="outline"
            :loading="isLoadingMore"
            :disabled="isLoadingMore"
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
