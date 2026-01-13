<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

const toast = useToast()

// State for form
const formState = reactive({
  isbn: ''
})

const isLookingUp = ref(false)
const isAdding = ref(false)

interface LookupResult {
  found: boolean
  isbn: string
  title?: string
  author?: string
  coverUrl?: string | null
  publishDate?: string
  publishers?: string[]
  numberOfPages?: number
  description?: string
  subjects?: string[]
  message?: string
  existsLocally?: boolean
}

const lookupResult = ref<LookupResult | null>(null)

// ISBN validation schema
const isbnSchema = z.object({
  isbn: z.string('ISBN is required').min(10, 'ISBN must be at least 10 characters').max(17, 'ISBN is too long')
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
      description: error.data?.message || error.message || 'Failed to lookup book',
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
      body: { isbn: lookupResult.value.isbn }
    })

    toast.add({
      title: 'Book added!',
      description: `${lookupResult.value.title} has been added to your library`,
      color: 'success'
    })

    // Navigate back to library
    navigateTo('/library')
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

// Reset lookup
function resetLookup() {
  lookupResult.value = null
  formState.isbn = ''
}
</script>

<template>
  <UContainer>
    <!-- Page Header -->
    <UPageHeader
      title="Add Book"
      description="Enter an ISBN to find and add a book to your library."
    >
      <template #links>
        <UButton
          to="/library"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
        >
          Back to Library
        </UButton>
      </template>
    </UPageHeader>

    <!-- Page Body -->
    <UPageBody>
      <div class="flex justify-center">
        <div class="w-full max-w-xl">
          <!-- Step 1: ISBN Lookup -->
          <UCard v-if="!lookupResult?.found">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-search"
                  class="text-lg"
                />
                <span class="font-semibold">Find Book by ISBN</span>
              </div>
            </template>

            <UForm
              :schema="isbnSchema"
              :state="formState"
              class="space-y-4"
              @submit="lookupISBN"
            >
              <UFormField
                label="ISBN"
                name="isbn"
                required
              >
                <UInput
                  v-model="formState.isbn"
                  name="isbn"
                  placeholder="e.g., 9780385533225"
                  size="lg"
                  class="w-full"
                />
              </UFormField>

              <p class="text-sm text-muted">
                You can find the ISBN on the back cover of most books, usually above the barcode.
              </p>

              <UButton
                type="submit"
                block
                size="lg"
                :loading="isLookingUp"
              >
                <UIcon
                  name="i-lucide-search"
                  class="mr-2"
                />
                Look Up Book
              </UButton>
            </UForm>
          </UCard>

          <!-- Step 2: Confirm Add -->
          <UCard v-else>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-book-check"
                  class="text-lg text-success"
                />
                <span class="font-semibold">Book Found</span>
              </div>
            </template>

            <div class="space-y-6">
              <div class="flex gap-6">
                <!-- Cover Preview - show OpenLibrary cover -->
                <div class="w-32 max-h-48 flex-shrink-0 rounded-lg overflow-hidden shadow-md">
                  <img
                    v-if="lookupResult.coverUrl"
                    :src="lookupResult.coverUrl"
                    :alt="lookupResult.title"
                    class="max-w-full max-h-full object-cover"
                    loading="eager"
                  >
                  <div
                    v-else
                    class="w-full h-full flex items-center justify-center bg-muted aspect-[1/1.5]"
                  >
                    <UIcon
                      name="i-lucide-book"
                      class="text-4xl text-muted"
                    />
                  </div>
                </div>

                <!-- Book Details -->
                <div class="flex-1 space-y-3">
                  <h2 class="text-xl font-semibold">
                    {{ lookupResult.title }}
                  </h2>
                  <p class="text-muted">
                    {{ lookupResult.author }}
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <UBadge
                      color="neutral"
                      variant="subtle"
                    >
                      ISBN: {{ lookupResult.isbn }}
                    </UBadge>
                    <UBadge
                      v-if="lookupResult.publishDate"
                      color="neutral"
                      variant="subtle"
                    >
                      {{ lookupResult.publishDate }}
                    </UBadge>
                    <UBadge
                      v-if="lookupResult.numberOfPages"
                      color="neutral"
                      variant="subtle"
                    >
                      {{ lookupResult.numberOfPages }} pages
                    </UBadge>
                  </div>
                  <p
                    v-if="lookupResult.publishers && lookupResult.publishers.length > 0"
                    class="text-sm text-muted"
                  >
                    Publisher: {{ lookupResult.publishers.join(', ') }}
                  </p>
                </div>
              </div>

              <!-- Description preview -->
              <div
                v-if="lookupResult.description"
                class="text-sm text-muted line-clamp-3"
              >
                {{ lookupResult.description }}
              </div>

              <!-- Subjects preview -->
              <div
                v-if="lookupResult.subjects && lookupResult.subjects.length > 0"
                class="flex flex-wrap gap-2"
              >
                <UBadge
                  v-for="subject in lookupResult.subjects.slice(0, 5)"
                  :key="subject"
                  size="md"
                  color="secondary"
                  variant="subtle"
                >
                  {{ subject }}
                </UBadge>
                <span
                  v-if="lookupResult.subjects.length > 5"
                  class="text-sm text-muted self-center"
                >
                  +{{ lookupResult.subjects.length - 5 }} more
                </span>
              </div>

              <USeparator />

              <!-- Adding state with explanation -->
              <div
                v-if="isAdding"
                class="text-center py-4"
              >
                <UIcon
                  name="i-lucide-loader-2"
                  class="animate-spin text-2xl text-primary mb-2"
                />
                <p class="text-sm text-muted">
                  Adding book and downloading cover image...
                </p>
              </div>

              <div
                v-else
                class="flex gap-3"
              >
                <UButton
                  color="neutral"
                  variant="outline"
                  size="lg"
                  @click="resetLookup"
                >
                  <UIcon
                    name="i-lucide-arrow-left"
                    class="mr-2"
                  />
                  Search Again
                </UButton>
                <UButton
                  size="lg"
                  class="flex-1"
                  @click="addBookToLibrary"
                >
                  <UIcon
                    name="i-lucide-plus"
                    class="mr-2"
                  />
                  Add to Library
                </UButton>
              </div>
            </div>
          </UCard>

          <!-- Future: Manual entry option -->
          <div class="mt-6 text-center">
            <p class="text-sm text-muted">
              Can't find your book? Manual entry coming soon.
            </p>
          </div>
        </div>
      </div>
    </UPageBody>
  </UContainer>
</template>
