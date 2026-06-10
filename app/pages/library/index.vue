<script setup lang="ts">
import type { LibraryBook, BatchDeleteResult } from '~~/shared/types/book'
import { buildLibraryRouteQuery, normalizeLibraryQuery } from '~~/shared/utils/library-query'

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

// Pagination state
const isLoadingMore = ref(false)
const filterRefreshTimer = ref<ReturnType<typeof setTimeout> | null>(null)

// Selection state
const isSelectMode = ref(false)
const selectedBooks = shallowRef<Set<string>>(new Set())

const shouldFetchInitial = allBooks.value.length === 0 || !paginationState.value

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
    location: location.value || undefined
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
)
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

watch([search, loanStatus, readingStatus, tag, location], () => {
  if (filterRefreshTimer.value) clearTimeout(filterRefreshTimer.value)

  filterRefreshTimer.value = setTimeout(() => {
    void applyFilters()
  }, 250)
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
    location: location.value.trim() || undefined
  })

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
      <div class="mb-6 space-y-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          size="lg"
          placeholder="Search title, author, ISBN, tag, or location"
          class="w-full"
        />

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
            placeholder="Filter location"
          />
        </div>

        <div
          v-if="hasActiveFilters"
          class="flex justify-end"
        >
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-x"
            @click="clearFilters"
          >
            Clear filters
          </UButton>
        </div>
      </div>

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
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
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
