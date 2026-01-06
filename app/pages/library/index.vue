<script setup lang="ts">
import { ref } from 'vue'

// Require authentication
definePageMeta({
  middleware: 'auth'
})

interface Book {
  id: string
  title: string
  author: string
  isbn: string | null
  coverPath: string | null
  createdAt: string
}

const { session, signOut } = useAuth()
const isAddModalOpen = ref(false)

// Fetch books
const { data: books, refresh, status } = await useFetch<Book[]>('/api/books', {
  headers: useRequestHeaders(['cookie'])
})

// Add book form
const newBook = ref({
  title: '',
  author: '',
  isbn: ''
})
const coverFile = ref<File | null>(null)
const isSubmitting = ref(false)
const submitError = ref('')

function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files && target.files[0]) {
    coverFile.value = target.files[0]
  }
}

async function handleAddBook() {
  submitError.value = ''

  if (!newBook.value.title || !newBook.value.author) {
    submitError.value = 'Title and author are required'
    return
  }

  isSubmitting.value = true

  try {
    const formData = new FormData()
    formData.append('title', newBook.value.title)
    formData.append('author', newBook.value.author)
    if (newBook.value.isbn) {
      formData.append('isbn', newBook.value.isbn)
    }
    if (coverFile.value) {
      formData.append('cover', coverFile.value)
    }

    const response = await $fetch('/api/books', {
      method: 'POST',
      body: formData
    })

    // Reset form and close modal
    newBook.value = { title: '', author: '', isbn: '' }
    coverFile.value = null
    isAddModalOpen.value = false

    // Refresh book list
    await refresh()
  } catch (e: any) {
    submitError.value = e.message || 'Failed to add book'
  } finally {
    isSubmitting.value = false
  }
}

async function handleDeleteBook(bookId: string) {
  try {
    await $fetch(`/api/books/${bookId}`, {
      method: 'DELETE'
    })
    await refresh()
  } catch (e: any) {
    console.error('Failed to delete book:', e)
  }
}

async function handleSignOut() {
  await signOut()
  navigateTo('/auth/login')
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
    <!-- Header -->
    <header class="bg-white dark:bg-gray-800 shadow">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
            Libroo
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            Welcome, {{ session.data?.user?.name }}
          </p>
        </div>
        <div class="flex items-center gap-4">
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
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <!-- Loading State -->
      <div v-if="status === 'pending'" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="animate-spin text-4xl text-gray-400" />
      </div>

      <!-- Empty State -->
      <div
        v-else-if="!books || books.length === 0"
        class="text-center py-16"
      >
        <UIcon name="i-lucide-book-open" class="text-6xl text-gray-300 dark:text-gray-600 mx-auto mb-4" />
        <h2 class="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Your library is empty
        </h2>
        <p class="text-gray-500 dark:text-gray-400 mb-6">
          Start by adding your first book to your collection.
        </p>
        <UButton
          icon="i-lucide-plus"
          size="lg"
          @click="isAddModalOpen = true"
        >
          Add Your First Book
        </UButton>
      </div>

      <!-- Book Grid -->
      <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
        <UCard
          v-for="book in books"
          :key="book.id"
          class="overflow-hidden group"
        >
          <!-- Cover Image -->
          <div class="aspect-[2/3] bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900 dark:to-primary-800 flex items-center justify-center relative">
            <img
              v-if="book.coverPath"
              :src="`/api/blob/${book.coverPath}`"
              :alt="book.title"
              class="w-full h-full object-cover"
            >
            <UIcon
              v-else
              name="i-lucide-book"
              class="text-4xl text-primary-400 dark:text-primary-600"
            />

            <!-- Delete button overlay -->
            <div class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <UButton
                color="error"
                variant="solid"
                icon="i-lucide-trash-2"
                size="sm"
                @click="handleDeleteBook(book.id)"
              >
                Delete
              </UButton>
            </div>
          </div>

          <!-- Book Info -->
          <template #footer>
            <div class="space-y-1">
              <h3 class="font-semibold text-sm text-gray-900 dark:text-white line-clamp-1">
                {{ book.title }}
              </h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">
                {{ book.author }}
              </p>
            </div>
          </template>
        </UCard>
      </div>
    </main>

    <!-- Add Book Modal -->
    <USlideover v-model:open="isAddModalOpen">
      <template #content>
        <div class="p-6">
          <h2 class="text-xl font-semibold mb-6">
            Add New Book
          </h2>

          <form class="space-y-4" @submit.prevent="handleAddBook">
            <UAlert
              v-if="submitError"
              color="error"
              variant="subtle"
              :title="submitError"
              icon="i-lucide-alert-circle"
            />

            <UFormField label="Title" name="title" required>
              <UInput
                v-model="newBook.title"
                type="text"
                placeholder="Book title"
                size="lg"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Author" name="author" required>
              <UInput
                v-model="newBook.author"
                type="text"
                placeholder="Author name"
                size="lg"
                class="w-full"
              />
            </UFormField>

            <UFormField label="ISBN" name="isbn">
              <UInput
                v-model="newBook.isbn"
                type="text"
                placeholder="ISBN (optional)"
                size="lg"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Cover Image" name="cover">
              <input
                type="file"
                accept="image/*"
                class="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100 dark:file:bg-primary-900 dark:file:text-primary-300"
                @change="handleFileChange"
              >
            </UFormField>

            <div class="flex gap-4 pt-4">
              <UButton
                type="button"
                color="neutral"
                variant="outline"
                block
                @click="isAddModalOpen = false"
              >
                Cancel
              </UButton>
              <UButton
                type="submit"
                block
                :loading="isSubmitting"
              >
                Add Book
              </UButton>
            </div>
          </form>
        </div>
      </template>
    </USlideover>
  </div>
</template>
