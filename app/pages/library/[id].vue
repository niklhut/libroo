<script setup lang="ts">

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
  workKey: string | null
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

// Format date nicely
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
  <UContainer class="py-8 max-w-6xl">
    <!-- Page Header -->
    <UPageHeader
      :title="book?.title || 'Book Details'"
      :description="book?.author"
    />

    <!-- Page Body -->
    <UPageBody>
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
      <div v-else class="grid md:grid-cols-[280px_1fr] gap-8">
        <!-- Cover -->
        <div>
          <div class="aspect-[2/3] bg-muted rounded-lg overflow-hidden shadow-lg">
            <!-- Use img directly for blob URLs (already WebP optimized) -->
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
          <!-- Metadata Grid -->
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
            <p class="text-muted leading-relaxed whitespace-pre-wrap">{{ book.description }}</p>
          </div>

          <!-- Subjects -->
          <div v-if="book.subjects && book.subjects.length > 0">
            <h2 class="text-lg font-semibold mb-2">Subjects</h2>
            <div class="flex flex-wrap gap-2">
              <UBadge
                v-for="subject in book.subjects"
                :key="subject"
                color="secondary"
                variant="subtle"
                size="md"
              >
                {{ subject }}
              </UBadge>
            </div>
          </div>

          <!-- Actions -->
          <USeparator />
          <div class="flex flex-wrap gap-3">
            <UButton
              to="/library"
              color="neutral"
              variant="outline"
              icon="i-lucide-arrow-left"
            >
              Back to Library
            </UButton>
            <UButton
              v-if="book.openLibraryKey"
              color="neutral"
              variant="outline"
              icon="i-lucide-external-link"
              :href="`https://openlibrary.org${book.openLibraryKey}`"
              target="_blank"
            >
              View Edition
            </UButton>
            <UButton
              v-if="book.workKey"
              color="neutral"
              variant="outline"
              icon="i-lucide-library"
              :href="`https://openlibrary.org${book.workKey}`"
              target="_blank"
            >
              View Work
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
    </UPageBody>
  </UContainer>
</template>
