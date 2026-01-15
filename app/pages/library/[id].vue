<script setup lang="ts">
const route = useRoute()
const toast = useToast()

const userBookId = route.params.id as string

// Fetch book details
const { data: book, status } = await useFetch<BookDetails>(`/api/books/${userBookId}`, {
  headers: useRequestHeaders(['cookie'])
})

// Computed cover URL
const coverUrl = computed(() => {
  if (book.value?.coverPath) {
    return `/api/blob/${book.value.coverPath}`
  }
  return null
})

// Format date helper function
function formatDate(dateInput: string | Date | null): string | null {
  if (!dateInput) return null

  // 1. If it's just a year (e.g., "2015"), return it immediately
  if (typeof dateInput === 'string' && /^\d{4}$/.test(dateInput)) {
    return dateInput
  }

  // 2. Perform a single Date construction/validation
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput)

  // 3. If the Date is valid, return a single toLocaleDateString result
  if (!isNaN(date.getTime())) {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  // 4. Otherwise return the original as a string
  return String(dateInput)
}

// Format dates nicely
const formattedAddedAt = computed(() => formatDate(book.value?.addedAt ?? null))
const formattedPublishDate = computed(() => formatDate(book.value?.publishDate ?? null))

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
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (err as { data?: { message?: string } })?.data?.message || 'An error occurred'
    toast.add({
      title: 'Failed to remove book',
      description: message,
      color: 'error'
    })
  }
}
</script>

<template>
  <UContainer>
    <!-- Page Body -->
    <UPageBody>
      <!-- Loading State -->
      <div
        v-if="status === 'pending'"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <!-- Not Found -->
      <UCard
        v-else-if="!book"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-book-x"
          class="text-6xl text-muted mx-auto mb-4"
        />
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
      <div
        v-else
        class="md:flex md:gap-8"
      >
        <!-- Cover - Small centered on mobile, sticky on desktop -->
        <div class="flex justify-center mb-6 md:mb-0 md:block md:shrink-0 md:w-[280px]">
          <div class="w-40 md:w-[280px] md:sticky md:top-24 md:self-start">
            <div class="rounded-lg overflow-hidden shadow-lg">
              <NuxtImg
                v-if="coverUrl"
                :src="coverUrl"
                :alt="book.title"
                width="280"
                height="420"
                preload
              />
              <div
                v-else
                class="w-full h-full flex items-center justify-center bg-muted aspect-[1/1.5]"
              >
                <UIcon
                  name="i-lucide-book"
                  class="text-6xl text-muted"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- Info -->
        <div class="space-y-3 md:flex-1">
          <!-- Title & Author -->
          <div class="text-center md:text-left">
            <h1 class="text-3xl md:text-4xl font-bold tracking-tight">
              {{ book.title }}
            </h1>
            <p class="text-lg text-muted mt-2">
              {{ book.author }}
            </p>
          </div>

          <!-- Metadata -->
          <div class="space-y-2 md:flex-1">
            <!-- Compact Metadata -->
            <div class="flex flex-wrap items-center justify-center md:justify-start gap-x-2 gap-y-1 text-sm text-muted">
              <span v-if="formattedPublishDate">
                Published {{ formattedPublishDate }}
              </span>
              <span
                v-if="formattedPublishDate && book.publishers"
                class="text-muted/50"
              >•</span>
              <span v-if="book.publishers">
                {{ book.publishers }}
              </span>
              <span
                v-if="(formattedPublishDate || book.publishers) && book.numberOfPages"
                class="text-muted/50"
              >•</span>
              <span v-if="book.numberOfPages">
                {{ book.numberOfPages }} pages
              </span>
            </div>

            <!-- ISBN -->
            <div class="flex flex-wrap items-center justify-center md:justify-start gap-x-2 gap-y-1 text-sm text-muted">
              <span v-if="book.isbn">
                ISBN: {{ book.isbn }}
              </span>
            </div>

            <!-- Added At -->
            <div class="flex flex-wrap items-center justify-center md:justify-start gap-x-2 gap-y-1 text-sm text-muted">
              <span v-if="formattedAddedAt">
                Added: {{ formattedAddedAt }}
              </span>
            </div>
          </div>

          <!-- Description -->
          <div v-if="book.description">
            <h2 class="text-lg font-semibold mb-2">
              Description
            </h2>
            <p class="text-muted leading-relaxed whitespace-pre-wrap">
              {{ book.description }}
            </p>
          </div>

          <!-- Subjects -->
          <div v-if="book.subjects && book.subjects.length > 0">
            <h2 class="text-lg font-semibold mb-2">
              Subjects
            </h2>
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
