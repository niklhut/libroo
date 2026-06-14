<script setup lang="ts">
import type { LibraryBook, BatchDeleteResult, BookLocationWithCount } from '~~/shared/types/book'
import {
  buildLibraryRouteQuery,
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
  removeBooks: removeBooksAction,
  getLoadedPages: getLoadedPagesAction,
  clearNeedsSync: clearNeedsSyncAction,
  resetResults: resetResultsAction
} = dashboardStore

const routeState = normalizeLibraryQuery(route.query)
const hasRouteStateMismatch = pageSize.value !== routeState.pageSize
  || search.value !== (routeState.search ?? '')
  || loanStatus.value !== (routeState.loanStatus ?? 'all')
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

// Selection state
const isSelectMode = ref(false)
const selectedBooks = shallowRef<Set<string>>(new Set())

const shouldFetchInitial = allBooks.value.length === 0 || !paginationState.value

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
    loanStatus: loanStatus.value === 'all' ? undefined : loanStatus.value,
    readingStatus: readingStatus.value === 'all' ? undefined : readingStatus.value,
    tag: tag.value || undefined,
    location: location.value || undefined,
    locationId: locationId.value || undefined,
    includeLocationDescendants: includeLocationDescendants.value || undefined,
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
  || loanStatus.value !== 'all'
  || readingStatus.value !== 'all'
  || Boolean(tag.value.trim())
  || Boolean(location.value.trim())
  || Boolean(locationId.value)
  || includeLocationDescendants.value
  || sortBy.value !== 'dateAdded'
)
const activeAdvancedFilterCount = computed(() => getActiveLibraryFilterCount({
  loanStatus: loanStatus.value,
  readingStatus: readingStatus.value,
  tag: tag.value,
  location: location.value,
  locationId: locationId.value,
  includeLocationDescendants: includeLocationDescendants.value,
  sortBy: sortBy.value,
  groupByLocation: groupByLocation.value
}))
const hasActiveAdvancedFilters = computed(() => activeAdvancedFilterCount.value > 0)
const selectedCount = computed(() => selectedBooks.value.size)
const allSelected = computed(() => books.value.length > 0 && selectedBooks.value.size === books.value.length)
const loanStatusItems = [
  { label: 'All loans', value: 'all' },
  { label: 'Available', value: 'available' },
  { label: 'Loaned out', value: 'loaned' }
]
const readingStatusItems = [
  { label: 'All reading', value: 'all' },
  { label: 'Unread', value: 'unread' },
  { label: 'Reading', value: 'reading' },
  { label: 'Read', value: 'read' }
]
const sortItems = [
  { label: 'Date added', value: 'dateAdded' },
  { label: 'Location path', value: 'locationPath' },
  { label: 'Title', value: 'title' },
  { label: 'Author', value: 'author' }
]
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
  loanStatus: loanStatus.value,
  readingStatus: readingStatus.value,
  tag: tag.value,
  location: location.value,
  locationId: locationId.value,
  includeLocationDescendants: includeLocationDescendants.value,
  sortBy: sortBy.value,
  groupByLocation: groupByLocation.value
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

watch([search, loanStatus, readingStatus, tag, location, locationId, includeLocationDescendants, sortBy], () => {
  if (filterRefreshTimer.value) clearTimeout(filterRefreshTimer.value)

  filterRefreshTimer.value = setTimeout(() => {
    void applyFilters()
  }, 250)
})

watch(locationId, (nextLocationId) => {
  if (!nextLocationId) {
    includeLocationDescendants.value = false
  }
})

async function applyFilters() {
  resetResultsAction()
  selectedBooks.value = new Set()
  isSelectMode.value = false

  updateBrowserQuery({
    page: 1,
    pageSize: pageSize.value,
    search: search.value.trim() || undefined,
    loanStatus: loanStatus.value,
    readingStatus: readingStatus.value,
    tag: tag.value.trim() || undefined,
    location: location.value.trim() || undefined,
    locationId: locationId.value || undefined,
    includeLocationDescendants: includeLocationDescendants.value,
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
  readingStatus.value = 'all'
  tag.value = ''
  location.value = ''
  locationId.value = ''
  includeLocationDescendants.value = false
  sortBy.value = 'dateAdded'
  groupByLocation.value = false
}

// Toggle select mode
function toggleSelectMode() {
  isSelectMode.value = !isSelectMode.value
  if (!isSelectMode.value) {
    selectedBooks.value = new Set()
  }
}

// Toggle book selection
function toggleBookSelection(id: string) {
  if (selectedBooks.value.has(id)) {
    selectedBooks.value.delete(id)
  } else {
    selectedBooks.value.add(id)
  }
  // Force reactivity
  selectedBooks.value = new Set(selectedBooks.value)
}

// Select all / deselect all
function toggleSelectAll() {
  if (allSelected.value) {
    selectedBooks.value = new Set()
  } else {
    selectedBooks.value = new Set(books.value.map(b => b.id))
  }
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

// Delete selected books
const isDeleting = ref(false)
async function deleteSelected() {
  if (selectedBooks.value.size === 0) return

  isDeleting.value = true

  try {
    // Call the batch delete endpoint
    const selectedIds = Array.from(selectedBooks.value)

    const response = await $fetch<BatchDeleteResult>('/api/books/batch-delete', {
      method: 'POST',
      body: { ids: selectedIds }
    })

    const { removedIds, failedIds } = response

    // Remove successfully deleted books from selection
    if (removedIds.length > 0) {
      removedIds.forEach(id => selectedBooks.value.delete(id))
      // Force reactivity
      selectedBooks.value = new Set(selectedBooks.value)
    }

    // Toggle off select mode only if everything was removed
    if (selectedBooks.value.size === 0) {
      isSelectMode.value = false
    }

    // Prepare toast message
    if (failedIds.length === 0) {
      toast.add({
        title: 'Books removed',
        description: `${removedIds.length} book(s) removed from your library`,
        color: 'success'
      })
    } else {
      const failedMessage = `Failed IDs: ${failedIds.join(', ')}`

      toast.add({
        title: 'Partial success',
        description: `${removedIds.length} removed, ${failedIds.length} failed. ${failedMessage}`,
        color: 'warning'
      })
    }

    // Keep dashboard state intact while removing deleted books from cache
    if (removedIds.length > 0) {
      removeBooksAction(removedIds)
      await syncLoadedPages(getLoadedPagesAction())
    }
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (err as { data?: { message?: string } })?.data?.message || 'An error occurred'
    toast.add({
      title: 'Error processing deletion',
      description: message,
      color: 'error'
    })
  } finally {
    isDeleting.value = false
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
        <!-- Select mode toggle - fixed width -->
        <UButton
          v-if="hasBooks"
          size="lg"
          color="neutral"
          variant="outline"
          icon="i-lucide-check-square"
          class="min-w-25"
          @click="toggleSelectMode"
        >
          {{ isSelectMode ? 'Cancel' : 'Select' }}
        </UButton>
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
      <section class="mb-6 space-y-3">
        <div class="flex flex-col gap-3 md:flex-row md:items-center">
          <UInput
            v-model="search"
            icon="i-lucide-search"
            size="lg"
            placeholder="Search title, author, ISBN, tag, or location"
            class="w-full md:flex-1"
          />

          <div class="flex w-full flex-wrap items-center gap-2 md:w-auto">
            <UButton
              size="lg"
              color="neutral"
              variant="outline"
              icon="i-lucide-sliders-horizontal"
              :trailing-icon="areFiltersExpanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              :aria-expanded="areFiltersExpanded"
              aria-controls="library-advanced-filters"
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
          class="flex flex-wrap items-center gap-2 text-sm text-muted"
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
              class="space-y-3 rounded-lg border border-default bg-muted/30 p-3"
            >
              <div class="grid gap-3 md:grid-cols-4">
                <USelect
                  v-model="loanStatus"
                  :items="loanStatusItems"
                  class="w-full"
                />
                <USelect
                  v-model="readingStatus"
                  :items="readingStatusItems"
                  class="w-full"
                />
                <UInput
                  v-model="tag"
                  icon="i-lucide-tag"
                  placeholder="Filter tag"
                />
                <UInput
                  v-model="location"
                  icon="i-lucide-map-pin"
                  placeholder="Search location path"
                />
              </div>

              <div class="grid gap-3 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto] md:items-center">
                <USelect
                  v-model="selectedLocationFilter"
                  :items="locationOptions"
                  icon="i-lucide-map-pin"
                  class="w-full"
                />
                <USelect
                  v-model="sortBy"
                  :items="sortItems"
                  icon="i-lucide-arrow-up-down"
                  class="w-full"
                />
                <UCheckbox
                  v-model="includeLocationDescendants"
                  :disabled="!locationId"
                  label="Include sub-locations"
                />
                <USwitch
                  v-model="groupByLocation"
                  label="Group by location"
                />
              </div>
            </div>
          </template>
        </UCollapsible>
      </section>

      <!-- Selection toolbar -->
      <div
        v-if="isSelectMode && hasBooks"
        class="mb-6 p-4 bg-muted rounded-lg flex items-center justify-between"
      >
        <div class="flex items-center gap-4">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            @click="toggleSelectAll"
          >
            {{ allSelected ? 'Deselect All' : 'Select All' }}
          </UButton>
          <span class="text-sm text-muted">
            {{ selectedCount }} selected
          </span>
        </div>
        <DeleteConfirmDialog
          title="Delete selected books?"
          :description="`This will permanently remove ${selectedCount} selected ${selectedCount === 1 ? 'book' : 'books'} from your library.`"
          confirm-label="Delete Selected"
          @confirm="deleteSelected"
        >
          <template #trigger="{ open }">
            <UButton
              color="error"
              :disabled="selectedCount === 0 || isDeleting"
              :loading="isDeleting"
              icon="i-lucide-trash-2"
              @click="open"
            >
              Delete Selected
            </UButton>
          </template>
        </DeleteConfirmDialog>
      </div>

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
          Start by adding your first book using its ISBN.
        </p>
        <UButton
          icon="i-lucide-plus"
          size="lg"
          to="/library/add"
        >
          Add Your First Book
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
                :selectable="isSelectMode"
                :selected="selectedBooks.has(book.id)"
                @select="toggleBookSelection"
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
            :selectable="isSelectMode"
            :selected="selectedBooks.has(book.id)"
            @select="toggleBookSelection"
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
