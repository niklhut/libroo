<script setup lang="ts">
import type { LibraryBook, BatchDeleteResult } from '~~/shared/types/book'

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

// Pagination state
const page = ref(1)
const pageSize = ref(12)
const isLoadingMore = ref(false)

// Selection state
const isSelectMode = ref(false)
const selectedBooks = shallowRef<Set<string>>(new Set())

// Fetch books with pagination
const { data, refresh, status } = await useFetch<PaginatedResponse>('/api/books', {
  headers: useRequestHeaders(['cookie']),
  query: computed(() => ({
    page: page.value,
    pageSize: pageSize.value
  }))
})

// Accumulated books
const allBooks = ref<LibraryBook[]>([])

watch(data, (response) => {
  if (!response) return

  if (page.value === 1) {
    allBooks.value = [...response.items]
  } else {
    allBooks.value.push(...response.items)
  }
}, { immediate: true })

// Computed values
const books = computed(() => allBooks.value)
const pagination = computed(() => data.value?.pagination)
const hasBooks = computed(() => books.value.length > 0)
const selectedCount = computed(() => selectedBooks.value.size)
const allSelected = computed(() => books.value.length > 0 && selectedBooks.value.size === books.value.length)

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

    // Refresh if any changes made
    // The user requested to call refresh() after handling partial results
    if (removedIds.length > 0) {
      page.value = 1
      await refresh()
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
          class="min-w-[100px]"
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
        <UButton
          color="error"
          :disabled="selectedCount === 0"
          :loading="isDeleting"
          icon="i-lucide-trash-2"
          @click="deleteSelected"
        >
          Delete Selected
        </UButton>
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
        v-else-if="!hasBooks"
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
            :added-at="book.addedAt"
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
