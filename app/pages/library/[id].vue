<script setup lang="ts">
// Require authentication
definePageMeta({
  middleware: 'auth'
})

const route = useRoute()
const toast = useToast()

const userBookId = route.params.id as string

interface BookDetail {
  id: string
  bookId: string
  title: string
  author: string
  isbn: string | null
  coverPath: string | null
  description: string | null
  subjects: string[] | null
  publishDate: string | null
  publishers: string | null
  numberOfPages: number | null
  openLibraryKey: string | null
  addedAt: string
}

// Fetch book details
const { data: book, status } = await useFetch<BookDetail>(`/api/books/${userBookId}`, {
  headers: useRequestHeaders(['cookie'])
})

// Computed cover URL
const coverUrl = computed(() => {
  if (book.value?.coverPath) {
    return `/api/blob/${book.value.coverPath}`
  }
  return null
})

// Format date
const formattedAddedAt = computed(() => {
  if (!book.value?.addedAt) return null
  return new Date(book.value.addedAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
})

// Remove book
async function removeBook() {
  try {
    await $fetch(`/api/books/${userBookId}`, {
      method: 'DELETE'
    })

    toast.add({
      title: 'Book removed',
      description: 'The book has been removed from your library',
      color: 'success'
    })

    navigateTo('/library')
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
  <UContainer class="py-8 max-w-4xl">
    <!-- Back button -->
    <div class="mb-6">
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        to="/library"
      >
        Back to Library
      </UButton>
    </div>

    <!-- Loading State -->
    <div v-if="status === 'pending'" class="flex justify-center py-12">
      <UIcon name="i-lucide-loader-2" class="animate-spin text-4xl text-muted" />
    </div>

    <!-- Not Found -->
    <UCard v-else-if="!book" class="text-center py-12">
      <UIcon name="i-lucide-book-x" class="text-6xl text-muted mx-auto mb-4" />
      <h2 class="text-xl font-semibold mb-2">
        Book not found
      </h2>
      <p class="text-muted mb-6">
        This book doesn't exist or you don't have access to it.
      </p>
      <UButton to="/library">
        Back to Library
      </UButton>
    </UCard>

    <!-- Book Details -->
    <div v-else class="grid md:grid-cols-[250px_1fr] gap-8">
      <!-- Cover -->
      <div>
        <div class="aspect-[2/3] bg-muted rounded-lg overflow-hidden shadow-lg">
          <img
            v-if="coverUrl"
            :src="coverUrl"
            :alt="book.title"
            class="w-full h-full object-cover"
          >
          <div v-else class="w-full h-full flex items-center justify-center">
            <UIcon name="i-lucide-book" class="text-6xl text-muted" />
          </div>
        </div>
      </div>

      <!-- Info -->
      <div class="space-y-6">
        <div>
          <h1 class="text-3xl font-bold mb-2">{{ book.title }}</h1>
          <p class="text-xl text-muted">{{ book.author }}</p>
        </div>

        <!-- Metadata -->
        <div class="grid grid-cols-2 gap-4">
          <div v-if="book.isbn">
            <p class="text-sm text-muted">ISBN</p>
            <p class="font-medium">{{ book.isbn }}</p>
          </div>
          <div v-if="book.publishDate">
            <p class="text-sm text-muted">Published</p>
            <p class="font-medium">{{ book.publishDate }}</p>
          </div>
          <div v-if="book.publishers">
            <p class="text-sm text-muted">Publisher</p>
            <p class="font-medium">{{ book.publishers }}</p>
          </div>
          <div v-if="book.numberOfPages">
            <p class="text-sm text-muted">Pages</p>
            <p class="font-medium">{{ book.numberOfPages }}</p>
          </div>
          <div v-if="formattedAddedAt">
            <p class="text-sm text-muted">Added to Library</p>
            <p class="font-medium">{{ formattedAddedAt }}</p>
          </div>
        </div>

        <!-- Description -->
        <div v-if="book.description">
          <h2 class="text-lg font-semibold mb-2">Description</h2>
          <p class="text-muted">{{ book.description }}</p>
        </div>

        <!-- Subjects -->
        <div v-if="book.subjects && book.subjects.length > 0">
          <h2 class="text-lg font-semibold mb-2">Subjects</h2>
          <div class="flex flex-wrap gap-2">
            <UBadge
              v-for="subject in book.subjects.slice(0, 10)"
              :key="subject"
              color="neutral"
              variant="subtle"
            >
              {{ subject }}
            </UBadge>
          </div>
        </div>

        <!-- Actions -->
        <USeparator />
        <div class="flex gap-3">
          <UButton
            v-if="book.openLibraryKey"
            color="neutral"
            variant="outline"
            icon="i-lucide-external-link"
            :href="`https://openlibrary.org${book.openLibraryKey}`"
            target="_blank"
          >
            View on OpenLibrary
          </UButton>
          <UButton
            color="error"
            variant="outline"
            icon="i-lucide-trash-2"
            @click="removeBook"
          >
            Remove from Library
          </UButton>
        </div>
      </div>
    </div>
  </UContainer>
</template>
