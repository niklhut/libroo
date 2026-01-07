<script setup lang="ts">
// Require authentication
definePageMeta({
  middleware: 'auth'
})

interface LibraryBook {
  id: string
  bookId: string
  title: string
  author: string
  isbn: string | null
  coverPath: string | null
  addedAt: string
}

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

// Fetch books with pagination
const { data, refresh, status } = await useFetch<PaginatedResponse>('/api/books', {
  headers: useRequestHeaders(['cookie']),
  query: computed(() => ({
    page: page.value,
    pageSize: pageSize.value
  }))
})

// Computed values
const books = computed(() => data.value?.items || [])
const pagination = computed(() => data.value?.pagination)
const hasBooks = computed(() => books.value.length > 0)

// Load more
async function loadMore() {
  if (pagination.value?.hasMore) {
    page.value++
  }
}

// Remove book from library
async function removeBook(userBookId: string) {
  try {
    await $fetch(`/api/books/${userBookId}`, {
      method: 'DELETE'
    })

    toast.add({
      title: 'Book removed',
      description: 'The book has been removed from your library',
      color: 'success'
    })

    await refresh()
  } catch (error: any) {
    toast.add({
      title: 'Failed to remove book',
      description: error.data?.message || error.message || 'An error occurred',
      color: 'error'
    })
  }
}
</script>

<template>
  <UContainer class="py-8">
    <!-- Header -->
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
      <div>
        <h1 class="text-2xl font-bold">My Library</h1>
        <p v-if="pagination" class="text-muted mt-1">
          {{ pagination.totalItems }} {{ pagination.totalItems === 1 ? 'book' : 'books' }}
        </p>
      </div>
      <UButton
        icon="i-lucide-plus"
        size="lg"
        to="/library/add"
      >
        Add Book
      </UButton>
    </div>

    <!-- Loading State -->
    <div v-if="status === 'pending'" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-4xl text-muted" />
    </div>

    <!-- Empty State -->
    <UCard v-else-if="!hasBooks" class="text-center py-12">
      <UIcon name="i-lucide-book-open" class="text-6xl text-muted mx-auto mb-4" />
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
          :key="book.id"
          :id="book.id"
          :book-id="book.bookId"
          :title="book.title"
          :author="book.author"
          :isbn="book.isbn"
          :cover-path="book.coverPath"
          :added-at="book.addedAt"
          @remove="removeBook"
        />
      </div>

      <!-- Load More -->
      <div v-if="pagination?.hasMore" class="mt-8 text-center">
        <UButton
          color="neutral"
          variant="outline"
          @click="loadMore"
        >
          Load More
        </UButton>
      </div>

      <!-- Pagination Info -->
      <div v-if="pagination" class="mt-4 text-center text-sm text-muted">
        Showing {{ books.length }} of {{ pagination.totalItems }} books
      </div>
    </template>
  </UContainer>
</template>
