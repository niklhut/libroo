<script setup lang="ts">
const props = defineProps<{
  book: BookDetails
  isDeleting: boolean
  isUpdatingLibraryState: boolean
  formatDate: (value: Date | string | null) => string | null
}>()

const emit = defineEmits<{
  moveToLibrary: []
  moveToWishlist: []
  markPreviouslyOwned: []
  removeWishlist: []
  deleteRecord: []
}>()

const isOwnedBook = computed(() => props.book.libraryState === 'owned')
const menuItems = computed(() => [
  ...(isOwnedBook.value && !props.book.activeLoan ? [{ label: 'Move to Wishlist', icon: 'i-lucide-bookmark', onSelect: () => emit('moveToWishlist') }] : []),
  ...(isOwnedBook.value ? [{ label: 'No longer own this book', icon: 'i-lucide-history', onSelect: () => emit('markPreviouslyOwned') }] : []),
  ...(props.book.libraryState === 'wishlisted' ? [{ label: 'Remove from Wishlist', icon: 'i-lucide-x', color: 'error' as const, onSelect: () => emit('removeWishlist') }] : []),
  ...(props.book.libraryState === 'previously_owned' ? [{ label: 'Delete this book', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => emit('deleteRecord') }] : [])
])
</script>

<template>
  <header class="order-0 space-y-4">
    <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 class="text-3xl font-bold tracking-tight md:text-4xl">
          {{ book.title }}
        </h1>
        <p class="mt-2 text-lg text-muted">
          {{ book.authors.map(author => author.name).join(', ') || book.author }}
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <UButton
          v-if="book.libraryState === 'wishlisted'"
          size="sm"
          icon="i-lucide-arrow-up-right"
          :loading="isUpdatingLibraryState"
          :disabled="isUpdatingLibraryState"
          @click="emit('moveToLibrary')"
        >
          Move to Library
        </UButton>
        <UButton
          v-else-if="book.libraryState === 'previously_owned'"
          size="sm"
          icon="i-lucide-arrow-up-right"
          :loading="isUpdatingLibraryState"
          :disabled="isUpdatingLibraryState"
          @click="emit('moveToLibrary')"
        >
          Move to Library
        </UButton>
        <UDropdownMenu :items="menuItems">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-ellipsis"
            aria-label="More book actions"
            :disabled="isDeleting || isUpdatingLibraryState"
          />
        </UDropdownMenu>
      </div>
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted">
      <span
        v-if="book.publishDate"
        class="inline-flex items-center gap-1.5"
      ><UIcon
        name="i-lucide-calendar-days"
        class="size-4"
      /> Published {{ formatDate(book.publishDate) }}</span>
      <span
        v-if="book.publishers"
        class="inline-flex items-center gap-1.5"
      ><UIcon
        name="i-lucide-building-2"
        class="size-4"
      /> {{ book.publishers }}</span>
      <span
        v-if="book.numberOfPages"
        class="inline-flex items-center gap-1.5"
      ><UIcon
        name="i-lucide-book-open"
        class="size-4"
      /> {{ book.numberOfPages }} pages</span>
      <span
        v-if="book.isbn"
        class="inline-flex items-center gap-1.5"
      ><UIcon
        name="i-lucide-scan-barcode"
        class="size-4"
      /> ISBN {{ book.isbn }}</span>
      <span class="inline-flex items-center gap-1.5"><UIcon
        name="i-lucide-plus-circle"
        class="size-4"
      /> Added {{ formatDate(book.addedAt) }}</span>
    </div>
    <div
      v-if="book.description"
      class="max-w-3xl"
    >
      <h2 class="mb-2 text-lg font-semibold">
        Description
      </h2>
      <BookDescription :description="book.description" />
    </div>
  </header>
</template>
