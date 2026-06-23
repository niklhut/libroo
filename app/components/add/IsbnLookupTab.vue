<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import { storeToRefs } from 'pinia'

const toast = useToast()
const isbnLookupStore = useIsbnLookupStore()
const { isLookingUp, isAdding } = storeToRefs(isbnLookupStore)
const { lookupIsbn, addIsbnsToLibrary } = isbnLookupStore

const formState = reactive({
  isbn: ''
})

const lookupResult = ref<BookLookupResult | null>(null)

// Lookup book by ISBN
async function lookupISBN(payload: FormSubmitEvent<BookIsbnSchema>) {
  lookupResult.value = null

  const lookup = await lookupIsbn(payload.data.isbn)

  if (lookup.ok) {
    const result = lookup.result
    lookupResult.value = result

    if (result.found && result.existsLocally) {
      toast.add({
        title: 'Already in library',
        description: `${result.title || 'This book'} is already in your library`,
        color: 'info'
      })
    } else if (!result.found) {
      toast.add({
        title: 'Book not found',
        description: result.message || 'Could not find this book on OpenLibrary',
        color: 'warning'
      })
    }
  } else {
    toast.add({
      title: 'Lookup failed',
      description: lookup.message,
      color: 'error'
    })
  }
}

// Add book to library
async function addBookToLibrary() {
  if (!lookupResult.value?.found || lookupResult.value.existsLocally) return

  const result = await addIsbnsToLibrary([lookupResult.value.isbn])

  if (result.success.length === 1) {
    toast.add({
      title: 'Book added!',
      description: `${lookupResult.value.title} has been added to your library`,
      color: 'success'
    })

    navigateTo('/library')
    return
  }

  const failure = result.failed[0]
  const alreadyOwned = failure?.error === 'BookAlreadyOwnedError'
  if (alreadyOwned && lookupResult.value) {
    lookupResult.value.existsLocally = true
  }

  toast.add({
    title: alreadyOwned ? 'Already in library' : 'Failed to add book',
    description: alreadyOwned
      ? `${lookupResult.value.title || 'This book'} is already in your library`
      : 'Could not add this book to your library. Try again in a moment.',
    color: alreadyOwned ? 'info' : 'error'
  })
}

function reset() {
  lookupResult.value = null
  formState.isbn = ''
}

const previewTitle = computed(() => lookupResult.value?.existsLocally ? 'Already in Library' : 'Book Found')
const previewIconClass = computed(() => lookupResult.value?.existsLocally ? 'text-lg text-info' : 'text-lg text-success')

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
          :class="previewIconClass"
        />
        <span class="font-semibold">{{ previewTitle }}</span>
      </div>
    </template>

    <BookPreview
      :book="lookupResult"
      :is-adding="isAdding"
      back-label="Search Again"
      back-icon="i-lucide-arrow-left"
      :add-disabled="lookupResult.existsLocally"
      unavailable-label="Already in Library"
      @add="addBookToLibrary"
      @back="reset"
    />
  </UCard>
</template>
