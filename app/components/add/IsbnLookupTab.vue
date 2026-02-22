<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

const toast = useToast()

const formState = reactive({
  isbn: ''
})

const isLookingUp = ref(false)
const isAdding = ref(false)
const lookupResult = ref<BookLookupResult | null>(null)

// Lookup book by ISBN
async function lookupISBN(payload: FormSubmitEvent<BookIsbnSchema>) {
  isLookingUp.value = true
  lookupResult.value = null

  try {
    const result = await $fetch<BookLookupResult>('/api/books/lookup', {
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
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (err as { data?: { message?: string } })?.data?.message || 'Failed to lookup book'
    toast.add({
      title: 'Lookup failed',
      description: message,
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

    navigateTo('/library')
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (err as { data?: { message?: string } })?.data?.message || 'Failed to add book'
    toast.add({
      title: 'Failed to add book',
      description: message,
      color: 'error'
    })
  } finally {
    isAdding.value = false
  }
}

function reset() {
  lookupResult.value = null
  formState.isbn = ''
}

// Expose for parent to reset on tab change
defineExpose({ reset })
</script>

<template>
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
      :schema="bookIsbnSchema"
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
        icon="i-lucide-search"
        block
        size="lg"
        :loading="isLookingUp"
        :disabled="!formState.isbn.trim()"
      >
        Look Up Book
      </UButton>
    </UForm>
  </UCard>

  <!-- Step 2: Book Preview & Add -->
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

    <BookPreview
      :book="lookupResult"
      :is-adding="isAdding"
      back-label="Search Again"
      back-icon="i-lucide-arrow-left"
      @add="addBookToLibrary"
      @back="reset"
    />
  </UCard>
</template>
