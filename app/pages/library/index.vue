<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

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

interface LookupResult {
  found: boolean
  isbn: string
  title?: string
  author?: string
  coverUrl?: string | null
  publishDate?: string
  message?: string
}

const { session, signOut } = useAuth()
const toast = useToast()

// State
const isAddModalOpen = ref(false)
const isLookingUp = ref(false)
const isAdding = ref(false)
const lookupResult = ref<LookupResult | null>(null)
const isbnInput = ref('')

// Fetch books
const { data: books, refresh, status } = await useFetch<LibraryBook[]>('/api/books', {
  headers: useRequestHeaders(['cookie'])
})

// ISBN validation schema
const isbnSchema = z.object({
  isbn: z.string().min(10, 'ISBN must be at least 10 characters').max(17, 'ISBN is too long')
})

type IsbnSchema = z.output<typeof isbnSchema>

// Lookup book by ISBN
async function lookupISBN(payload: FormSubmitEvent<IsbnSchema>) {
  isLookingUp.value = true
  lookupResult.value = null

  try {
    const result = await $fetch<LookupResult>('/api/books/lookup', {
      method: 'POST',
      body: { isbn: payload.data.isbn }
    })
    lookupResult.value = result
    isbnInput.value = payload.data.isbn

    if (!result.found) {
      toast.add({
        title: 'Book not found',
        description: result.message || 'Could not find this book on OpenLibrary',
        color: 'warning'
      })
    }
  } catch (error: any) {
    toast.add({
      title: 'Lookup failed',
      description: error.message || 'Failed to lookup book',
      color: 'error'
    })
  } finally {
    isLookingUp.value = false
  }
}

// Add book to library
async function addBookToLibrary() {
  if (!lookupResult.value?.found) return

  isAdding.value = true

  try {
    await $fetch('/api/books', {
      method: 'POST',
      body: { isbn: isbnInput.value }
    })

    toast.add({
      title: 'Book added!',
      description: `${lookupResult.value.title} has been added to your library`,
      color: 'success'
    })

    // Reset and close modal
    lookupResult.value = null
    isbnInput.value = ''
    isAddModalOpen.value = false

    // Refresh book list
    await refresh()
  } catch (error: any) {
    const message = error.data?.message || error.message || 'Failed to add book'
    toast.add({
      title: 'Failed to add book',
      description: message,
      color: 'error'
    })
  } finally {
    isAdding.value = false
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
      description: error.message || 'An error occurred',
      color: 'error'
    })
  }
}

// Reset modal state when closed
function closeModal() {
  isAddModalOpen.value = false
  lookupResult.value = null
  isbnInput.value = ''
}

async function handleSignOut() {
  await signOut()
  navigateTo('/auth/login')
}
</script>

<template>
  <div>
    <!-- Header -->
    <UPageHeader
      title="My Library"
      :description="`Welcome, ${session.data?.user?.name || 'Reader'}`"
    >
      <template #actions>
        <UButton
          icon="i-lucide-plus"
          size="lg"
          @click="isAddModalOpen = true"
        >
          Add Book
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-log-out"
          @click="handleSignOut"
        >
          Sign Out
        </UButton>
      </template>
    </UPageHeader>

    <!-- Main Content -->
    <UContainer class="py-8">
      <!-- Loading State -->
      <div v-if="status === 'pending'" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="animate-spin text-4xl text-muted" />
      </div>

      <!-- Empty State -->
      <UPageCard
        v-else-if="!books || books.length === 0"
        class="text-center py-12"
      >
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
          @click="isAddModalOpen = true"
        >
          Add Your First Book
        </UButton>
      </UPageCard>

      <!-- Book Grid -->
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        <UCard
          v-for="book in books"
          :key="book.id"
          class="overflow-hidden group"
          :ui="{ body: 'p-0' }"
        >
          <!-- Cover Image -->
          <div class="aspect-[2/3] bg-muted flex items-center justify-center relative">
            <img
              v-if="book.coverPath"
              :src="`/api/blob/${book.coverPath}`"
              :alt="book.title"
              class="w-full h-full object-cover"
            >
            <UIcon
              v-else
              name="i-lucide-book"
              class="text-4xl text-muted"
            />

            <!-- Hover overlay with delete -->
            <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <UButton
                color="error"
                variant="solid"
                icon="i-lucide-trash-2"
                size="sm"
                @click="removeBook(book.id)"
              >
                Remove
              </UButton>
            </div>
          </div>

          <!-- Book Info -->
          <div class="p-3 space-y-1">
            <h3 class="font-semibold text-sm line-clamp-2">
              {{ book.title }}
            </h3>
            <p class="text-xs text-muted line-clamp-1">
              {{ book.author }}
            </p>
          </div>
        </UCard>
      </div>
    </UContainer>

    <!-- Add Book Modal -->
    <UModal v-model:open="isAddModalOpen" @close="closeModal">
      <template #content>
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="text-lg font-semibold">Add Book by ISBN</h2>
              <UButton
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                size="sm"
                @click="closeModal"
              />
            </div>
          </template>

          <!-- Step 1: ISBN Lookup -->
          <div v-if="!lookupResult?.found" class="space-y-4">
            <p class="text-muted text-sm">
              Enter the ISBN of the book you want to add. We'll look up the details from OpenLibrary.
            </p>

            <UForm :schema="isbnSchema" class="space-y-4" @submit="lookupISBN">
              <UFormField label="ISBN" name="isbn" required>
                <UInput
                  name="isbn"
                  placeholder="e.g., 9780385533225"
                  size="lg"
                  class="w-full"
                />
              </UFormField>

              <UButton
                type="submit"
                block
                size="lg"
                :loading="isLookingUp"
              >
                <UIcon name="i-lucide-search" class="mr-2" />
                Look Up Book
              </UButton>
            </UForm>
          </div>

          <!-- Step 2: Confirm Add -->
          <div v-else class="space-y-4">
            <div class="flex gap-4">
              <!-- Cover Preview -->
              <div class="w-24 h-36 flex-shrink-0 bg-muted rounded overflow-hidden">
                <img
                  v-if="lookupResult.coverUrl"
                  :src="lookupResult.coverUrl"
                  :alt="lookupResult.title"
                  class="w-full h-full object-cover"
                >
                <div v-else class="w-full h-full flex items-center justify-center">
                  <UIcon name="i-lucide-book" class="text-2xl text-muted" />
                </div>
              </div>

              <!-- Book Details -->
              <div class="flex-1 space-y-2">
                <h3 class="font-semibold text-lg">{{ lookupResult.title }}</h3>
                <p class="text-muted">{{ lookupResult.author }}</p>
                <p v-if="lookupResult.publishDate" class="text-sm text-muted">
                  Published: {{ lookupResult.publishDate }}
                </p>
                <UBadge color="neutral" variant="subtle">
                  ISBN: {{ lookupResult.isbn }}
                </UBadge>
              </div>
            </div>

            <div class="flex gap-3">
              <UButton
                color="neutral"
                variant="outline"
                block
                @click="lookupResult = null"
              >
                Back
              </UButton>
              <UButton
                block
                :loading="isAdding"
                @click="addBookToLibrary"
              >
                <UIcon name="i-lucide-plus" class="mr-2" />
                Add to Library
              </UButton>
            </div>
          </div>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
