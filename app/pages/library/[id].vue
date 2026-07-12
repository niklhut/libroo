<script setup lang="ts">
import { booleanConfigValue } from '~~/shared/utils/runtime-config'

const route = useRoute()
const config = useRuntimeConfig()
const toast = useToast()
const dashboardStore = useLibraryDashboardStore()
const { removeBooks, getLoadedPages, markNeedsSync, updateBookTags } = dashboardStore

const userBookId = route.params.id as string
const isDeleting = ref(false)
const isTagModalOpen = ref(false)
const isReadingModalOpen = ref(false)
const isLendingModalOpen = ref(false)
const isLocationModalOpen = ref(false)
const isLoanRemovalDialogOpen = ref(false)
const isOwnershipDialogOpen = ref(false)
const isWishlistRemovalDialogOpen = ref(false)
const isRecordDeletionDialogOpen = ref(false)
const isMoveToWishlistDialogOpen = ref(false)
const isMoveToLibraryDialogOpen = ref(false)
const isSavingReadingProgress = ref(false)
const isReturningLoan = ref(false)
const isUpdatingLibraryState = ref(false)

// Fetch book details
const { data: book, status, refresh } = await useFetch<BookDetails>(`/api/books/${userBookId}`, {
  headers: useRequestHeaders(['cookie'])
})

usePageTitle(computed(() => book.value?.title ?? 'Book'))

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
const showOpenLibraryLinks = computed(() =>
  booleanConfigValue(config.public.openLibraryLinksEnabled, false)
)
const isOwnedBook = computed(() => book.value?.libraryState === 'owned')

// Remove book
async function removeBook(confirmActiveLoan = false) {
  isDeleting.value = true

  try {
    await $fetch(`/api/books/${userBookId}`, {
      method: 'DELETE',
      query: confirmActiveLoan ? { confirmActiveLoan: 'true' } : undefined
    })

    removeBooks([userBookId])
    markNeedsSync(getLoadedPages())

    toast.add({
      title: 'Book removed',
      description: 'The book has been removed from your library',
      color: 'success'
    })

    navigateTo('/library')
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'An error occurred')
    const statusCode = (err as { statusCode?: number, data?: { statusCode?: number } })?.statusCode
      ?? (err as { data?: { statusCode?: number } })?.data?.statusCode

    if (statusCode === 409 && book.value?.activeLoan && !confirmActiveLoan) {
      isLoanRemovalDialogOpen.value = true
      return
    }

    toast.add({
      title: 'Failed to remove book',
      description: message,
      color: 'error'
    })
  } finally {
    isDeleting.value = false
  }
}

function markAsPreviouslyOwned() {
  isOwnershipDialogOpen.value = false
  void updateBookLibraryState('previously_owned')
}

function deleteBookRecord() {
  isOwnershipDialogOpen.value = false
  isWishlistRemovalDialogOpen.value = false
  isRecordDeletionDialogOpen.value = false
  void removeBook(false)
}

function moveToWishlist() {
  isMoveToWishlistDialogOpen.value = false
  void updateBookLibraryState('wishlisted')
}

function moveToLibrary() {
  isMoveToLibraryDialogOpen.value = false
  void updateBookLibraryState('owned')
}

async function onLoanSaved() {
  await refresh()
  markNeedsSync(getLoadedPages())
}

async function returnActiveLoan() {
  if (!book.value?.activeLoan || isReturningLoan.value) return

  isReturningLoan.value = true
  try {
    await $fetch(`/api/loans/${book.value.activeLoan.id}/return`, {
      method: 'POST'
    })
    await refresh()
    markNeedsSync(getLoadedPages())
    toast.add({
      title: 'Book marked as returned',
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'Unable to mark returned')
    toast.add({
      title: 'Could not update lending status',
      description: message,
      color: 'error'
    })
  } finally {
    isReturningLoan.value = false
  }
}

// Per-field request sequencing tokens to prevent stale rollbacks
let ratingRequestId = 0
let noteRequestId = 0
let readingRequestId = 0
let lastConfirmedRating: number | null = book.value?.rating ?? null
let lastConfirmedNote: string | null = book.value?.note ?? null

async function updateBookLibraryState(state: LibraryState) {
  if (!book.value || isUpdatingLibraryState.value) return

  const previousBook = book.value
  isUpdatingLibraryState.value = true

  book.value = {
    ...book.value,
    libraryState: state,
    ...(state === 'wishlisted'
      ? {
          location: null,
          lastKnownLocation: null,
          activeLoan: null,
          rating: null,
          readingProgress: {
            status: 'unread',
            currentPage: null,
            progressPercent: null,
            startedAt: null,
            finishedAt: null
          } satisfies ReadingProgress
        }
      : state === 'previously_owned'
        ? {
            location: null,
            lastKnownLocation: previousBook.location?.path ?? previousBook.lastKnownLocation ?? null,
            activeLoan: null
          }
        : {})
  }

  if (state === 'wishlisted') {
    lastConfirmedRating = null
  }

  try {
    await $fetch(`/api/books/${userBookId}/state`, {
      method: 'PUT',
      body: { state }
    })
    await refresh()
    markNeedsSync(getLoadedPages())
    toast.add({
      title: state === 'owned'
        ? 'Moved to library'
        : state === 'previously_owned'
          ? 'Marked previously owned'
          : 'Moved to wishlist',
      description: state === 'owned'
        ? 'Physical inventory options are now available.'
        : state === 'previously_owned'
          ? 'This book is kept in your history without active inventory controls.'
          : 'This book is now on your wishlist.',
      color: 'success'
    })
  } catch (err: unknown) {
    book.value = previousBook
    lastConfirmedRating = previousBook.rating
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'Unable to move book')
    toast.add({
      title: 'Could not update book state',
      description: message,
      color: 'error'
    })
  } finally {
    isUpdatingLibraryState.value = false
  }
}

function openTagModal() {
  isTagModalOpen.value = true
}

async function onTagsSaved() {
  try {
    await refresh()
    if (book.value) {
      updateBookTags(userBookId, book.value.userTags.map(tag => tag.name))
    }
    toast.add({
      title: 'Tags updated',
      description: 'Your tag changes were saved successfully.',
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'An error occurred')

    toast.add({
      title: 'Error updating tags',
      description: message,
      color: 'error'
    })
  }
}

// Rating
async function saveRating(rating: number | null) {
  const previousRating = lastConfirmedRating
  const currentRequestId = ++ratingRequestId
  // Optimistic update — replace object to trigger shallowRef reactivity
  if (book.value) {
    book.value = { ...book.value, rating }
  }
  try {
    await $fetch(`/api/books/${userBookId}/rating`, {
      method: 'PUT',
      body: { rating }
    })
    if (currentRequestId === ratingRequestId) {
      lastConfirmedRating = rating
    }
  } catch (err: unknown) {
    // Only revert if this is still the latest request
    if (currentRequestId === ratingRequestId && book.value) {
      book.value = { ...book.value, rating: previousRating }
    }
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'An error occurred')
    toast.add({
      title: 'Failed to save rating',
      description: message,
      color: 'error'
    })
  }
}

// Note
async function saveNote(note: string | null) {
  const previousNote = lastConfirmedNote
  const currentRequestId = ++noteRequestId
  // Optimistic update — replace object to trigger shallowRef reactivity
  if (book.value) {
    book.value = { ...book.value, note }
  }
  try {
    await $fetch(`/api/books/${userBookId}/note`, {
      method: 'PUT',
      body: { note }
    })
    if (currentRequestId === noteRequestId) {
      lastConfirmedNote = note
      toast.add({
        title: note ? 'Note saved' : 'Note removed',
        description: note ? 'Your note has been saved.' : 'Your note has been removed.',
        color: 'success'
      })
    }
  } catch (err: unknown) {
    // Only revert if this is still the latest request
    if (currentRequestId === noteRequestId && book.value) {
      book.value = { ...book.value, note: previousNote }
    }
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'An error occurred')
    toast.add({
      title: 'Failed to save note',
      description: message,
      color: 'error'
    })
  }
}

function onLocationSaved(location: BookLocation | null) {
  if (book.value) {
    book.value = { ...book.value, location }
  }
  markNeedsSync(getLoadedPages())
  toast.add({
    title: location ? 'Location saved' : 'Location cleared',
    color: 'success'
  })
}

async function saveReadingProgress(progress: {
  status: ReadingStatus
  currentPage: number | null
  progressPercent: number | null
  startedAt: string | null
  finishedAt: string | null
}) {
  const currentRequestId = ++readingRequestId
  isSavingReadingProgress.value = true

  if (book.value) {
    book.value = { ...book.value, readingProgress: progress }
  }

  try {
    const result = await $fetch<{ readingProgress: ReadingProgress }>(`/api/books/${userBookId}/reading`, {
      method: 'PUT',
      body: progress
    })

    if (currentRequestId === readingRequestId) {
      if (book.value) {
        book.value = { ...book.value, readingProgress: result.readingProgress }
      }
      toast.add({
        title: 'Progress saved',
        description: 'Your reading progress has been updated.',
        color: 'success'
      })
      isReadingModalOpen.value = false
    }
  } catch (err: unknown) {
    if (currentRequestId !== readingRequestId) {
      return
    }

    try {
      const details = await $fetch<BookDetails>(`/api/books/${userBookId}`)
      if (book.value) {
        book.value = { ...book.value, readingProgress: details.readingProgress }
      }
    } catch {
      await refresh()
    }

    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'An error occurred')
    toast.add({
      title: 'Failed to save progress',
      description: message,
      color: 'error'
    })
  } finally {
    if (currentRequestId === readingRequestId) {
      isSavingReadingProgress.value = false
    }
  }
}
</script>

<template>
  <UContainer>
    <!-- Page Body -->
    <UPageBody>
      <!-- Loading State -->
      <div
        v-if="status === 'pending' && !book"
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
        <div class="flex justify-center mb-6 md:mb-0 md:block md:shrink-0 md:w-70">
          <div class="w-40 md:w-70 md:sticky md:top-24 md:self-start">
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
                class="w-full h-full flex items-center justify-center bg-muted aspect-1/1.5"
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
            <div class="text-lg text-muted mt-2">
              <template v-if="book.authors.length > 0">
                <template
                  v-for="(author, index) in book.authors"
                  :key="author.id"
                >
                  <ULink
                    :to="`/library/authors/${author.id}`"
                    class="hover:text-primary"
                  >
                    {{ author.name }}
                  </ULink><span v-if="index < book.authors.length - 1">, </span>
                </template>
              </template>
              <span v-else>{{ book.author }}</span>
            </div>
          </div>

          <!-- Metadata -->
          <div class="space-y-2">
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
            <div
              v-if="book.isbn"
              class="text-sm text-muted text-center md:text-left"
            >
              ISBN: {{ book.isbn }}
            </div>

            <!-- Added At -->
            <div
              v-if="formattedAddedAt"
              class="text-sm text-muted text-center md:text-left"
            >
              Added: {{ formattedAddedAt }}
            </div>
            <div
              v-if="book.libraryState === 'wishlisted' || book.libraryState === 'previously_owned'"
              class="flex justify-center md:justify-start"
            >
              <UBadge
                :color="book.libraryState === 'wishlisted' ? 'info' : 'neutral'"
                variant="subtle"
              >
                {{ book.libraryState === 'wishlisted' ? 'Wishlist' : 'Previously owned' }}
              </UBadge>
            </div>
          </div>

          <!-- Physical Location -->
          <div
            v-if="isOwnedBook"
            class="space-y-3"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="text-lg font-semibold">
                  Location
                </h2>
                <div
                  class="mt-1 flex items-center gap-2 text-sm"
                  :class="book.location ? 'text-highlighted' : 'text-muted'"
                >
                  <UIcon
                    name="i-lucide-map-pin"
                    class="size-4 shrink-0"
                  />
                  <span>{{ book.location?.path || 'No location set' }}</span>
                </div>
              </div>
              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-pencil"
                @click="() => { isLocationModalOpen = true }"
              >
                Manage
              </UButton>
            </div>
          </div>

          <div
            v-else-if="book.libraryState === 'previously_owned' && book.lastKnownLocation"
            class="space-y-3"
          >
            <div>
              <h2 class="text-lg font-semibold">
                Last known location
              </h2>
              <div class="mt-1 flex items-center gap-2 text-sm text-muted">
                <UIcon
                  name="i-lucide-map-pin"
                  class="size-4 shrink-0"
                />
                <span>{{ book.lastKnownLocation }}</span>
              </div>
            </div>
          </div>

          <!-- Description -->
          <div v-if="book.description">
            <h2 class="text-lg font-semibold mb-2">
              Description
            </h2>
            <BookDescription :description="book.description" />
          </div>

          <!-- Rating -->
          <BookRating
            v-if="isOwnedBook"
            :rating="book.rating"
            @update:rating="saveRating"
          />

          <!-- Reading Progress -->
          <BookReadingProgress
            v-if="isOwnedBook"
            :progress="book.readingProgress"
            :total-pages="book.numberOfPages"
            @edit="isReadingModalOpen = true"
          />

          <div
            v-if="book.activeLoan"
            class="space-y-2"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-lg font-semibold">
                    Loan
                  </h2>
                  <UBadge
                    color="warning"
                    variant="subtle"
                  >
                    Lent out
                  </UBadge>
                </div>
                <p class="text-sm text-muted">
                  {{ book.activeLoan.acceptedByName || book.activeLoan.borrowerDisplayName }} has this book
                  <template v-if="book.activeLoan.acceptedByName && book.activeLoan.acceptedByName !== book.activeLoan.borrowerDisplayName">
                    · entered as {{ book.activeLoan.borrowerDisplayName }}
                  </template>
                  · Lent {{ formatDate(book.activeLoan.loanedAt) }}
                </p>
                <p
                  v-if="book.activeLoan.dueAt"
                  class="text-sm text-muted"
                >
                  Due {{ formatDate(book.activeLoan.dueAt) }}
                </p>
              </div>
              <UButton
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-undo-2"
                :loading="isReturningLoan"
                :disabled="isReturningLoan"
                @click="returnActiveLoan"
              >
                Mark returned
              </UButton>
            </div>
          </div>

          <!-- Your Note -->
          <BookNote
            :note="book.note"
            @update:note="saveNote"
          />

          <!-- Tags -->
          <div class="space-y-4">
            <div>
              <div class="flex items-center justify-between gap-3 mb-2">
                <h2 class="text-lg font-semibold">
                  Tags
                </h2>
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-tag"
                  @click="openTagModal"
                >
                  Manage Tags
                </UButton>
              </div>
              <div class="flex flex-wrap gap-2">
                <div
                  v-for="tag in book.userTags"
                  :key="tag.id"
                  class="inline-flex items-center gap-1"
                >
                  <UBadge
                    color="primary"
                    variant="subtle"
                    size="md"
                  >
                    {{ tag.name }}
                  </UBadge>
                </div>
              </div>
              <p
                v-if="book.userTags.length === 0"
                class="text-sm text-muted"
              >
                Use Manage Tags to add from suggestions or create your own.
              </p>
            </div>
          </div>

          <!-- Actions -->
          <USeparator />
          <div class="flex flex-wrap gap-3">
            <UButton
              v-if="isOwnedBook && !book.activeLoan"
              color="neutral"
              variant="outline"
              icon="i-lucide-handshake"
              @click="() => { isLendingModalOpen = true }"
            >
              Record loan
            </UButton>
            <UButton
              v-if="book.libraryState === 'wishlisted'"
              icon="i-lucide-arrow-up-right"
              :loading="isUpdatingLibraryState"
              :disabled="isUpdatingLibraryState"
              @click="() => { isMoveToLibraryDialogOpen = true }"
            >
              Move to Library
            </UButton>
            <UButton
              v-else-if="!isOwnedBook"
              icon="i-lucide-arrow-up-right"
              :loading="isUpdatingLibraryState"
              :disabled="isUpdatingLibraryState"
              @click="updateBookLibraryState('owned')"
            >
              Move to Library
            </UButton>
            <UButton
              v-if="isOwnedBook && !book.activeLoan"
              color="neutral"
              variant="outline"
              icon="i-lucide-bookmark"
              :loading="isUpdatingLibraryState"
              :disabled="isUpdatingLibraryState"
              @click="() => { isMoveToWishlistDialogOpen = true }"
            >
              Move to Wishlist
            </UButton>
            <UButton
              v-if="isOwnedBook"
              color="neutral"
              variant="outline"
              icon="i-lucide-history"
              :disabled="isUpdatingLibraryState || isDeleting"
              @click="() => { isOwnershipDialogOpen = true }"
            >
              No longer own this book
            </UButton>
            <UButton
              v-if="book.libraryState === 'wishlisted'"
              color="error"
              variant="subtle"
              icon="i-lucide-x"
              :disabled="isDeleting"
              @click="() => { isWishlistRemovalDialogOpen = true }"
            >
              Remove from Wishlist
            </UButton>
            <UButton
              v-if="book.libraryState === 'previously_owned'"
              color="error"
              variant="subtle"
              icon="i-lucide-trash-2"
              :disabled="isDeleting"
              @click="() => { isRecordDeletionDialogOpen = true }"
            >
              Delete this book
            </UButton>
            <UButton
              v-if="showOpenLibraryLinks && book.openLibraryKey"
              color="neutral"
              variant="outline"
              icon="i-lucide-external-link"
              :href="`https://openlibrary.org${book.openLibraryKey}`"
              target="_blank"
              rel="noopener noreferrer"
            >
              View Edition
            </UButton>
            <UButton
              v-if="showOpenLibraryLinks && book.workKey"
              color="neutral"
              variant="outline"
              icon="i-lucide-library"
              :href="`https://openlibrary.org${book.workKey}`"
              target="_blank"
              rel="noopener noreferrer"
            >
              View Work
            </UButton>
          </div>
        </div>
      </div>

      <TagManagerModal
        v-if="book"
        v-model:open="isTagModalOpen"
        :user-book-id="userBookId"
        :user-tags="book.userTags"
        :suggested-tags="book.suggestedTags"
        @saved="onTagsSaved"
      />

      <BookReadingProgressModal
        v-if="book && isOwnedBook"
        v-model:open="isReadingModalOpen"
        :progress="book.readingProgress"
        :total-pages="book.numberOfPages"
        :saving="isSavingReadingProgress"
        @save:progress="saveReadingProgress"
      />

      <BookLendingModal
        v-if="book && isOwnedBook"
        v-model:open="isLendingModalOpen"
        :user-book-id="userBookId"
        @saved="onLoanSaved"
      />

      <BookLocationModal
        v-if="book && isOwnedBook"
        v-model:open="isLocationModalOpen"
        :user-book-id="userBookId"
        :current-location="book.location"
        @saved="onLocationSaved"
      />

      <UModal
        v-if="book"
        v-model:open="isMoveToWishlistDialogOpen"
        title="Move to Wishlist?"
        description="This clears the book's location, rating, and reading progress."
        :close="false"
        :ui="{ content: 'max-w-md', footer: 'justify-end gap-2 p-5' }"
      >
        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            @click="() => { isMoveToWishlistDialogOpen = false }"
          >
            Cancel
          </UButton>
          <UButton
            icon="i-lucide-bookmark"
            :loading="isUpdatingLibraryState"
            @click="moveToWishlist"
          >
            Move to Wishlist
          </UButton>
        </template>
      </UModal>

      <UModal
        v-if="book"
        v-model:open="isMoveToLibraryDialogOpen"
        title="Move to Library?"
        description="This will make the book available for physical inventory and lending."
        :close="false"
        :ui="{ content: 'max-w-md', footer: 'justify-end gap-2 p-5' }"
      >
        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            @click="() => { isMoveToLibraryDialogOpen = false }"
          >
            Cancel
          </UButton>
          <UButton
            icon="i-lucide-arrow-up-right"
            :loading="isUpdatingLibraryState"
            @click="moveToLibrary"
          >
            Move to Library
          </UButton>
        </template>
      </UModal>

      <UModal
        v-if="book"
        v-model:open="isOwnershipDialogOpen"
        title="No longer own this book?"
        :description="book.activeLoan
          ? 'This book has an active loan, so it cannot be marked previously owned until the loan is returned. You can delete this book instead.'
          : 'Keep this book as previously owned, or delete this book.'"
        :close="false"
        :ui="{
          content: 'max-w-md',
          header: 'p-5',
          footer: 'flex-wrap justify-end gap-2 p-5'
        }"
      >
        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            @click="() => { isOwnershipDialogOpen = false }"
          >
            Cancel
          </UButton>
          <UButton
            v-if="!book.activeLoan"
            icon="i-lucide-history"
            :loading="isUpdatingLibraryState"
            @click="markAsPreviouslyOwned"
          >
            Previously owned
          </UButton>
          <UButton
            color="error"
            variant="subtle"
            icon="i-lucide-trash-2"
            :loading="isDeleting"
            :disabled="isUpdatingLibraryState"
            @click="deleteBookRecord"
          >
            Delete this book
          </UButton>
        </template>
      </UModal>

      <UModal
        v-if="book"
        v-model:open="isWishlistRemovalDialogOpen"
        title="Remove from Wishlist?"
        description="This book will no longer appear in your wishlist."
        :close="false"
        :ui="{ content: 'max-w-md', footer: 'justify-end gap-2 p-5' }"
      >
        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            @click="() => { isWishlistRemovalDialogOpen = false }"
          >
            Cancel
          </UButton>
          <UButton
            color="error"
            variant="subtle"
            icon="i-lucide-x"
            :loading="isDeleting"
            @click="deleteBookRecord"
          >
            Remove from Wishlist
          </UButton>
        </template>
      </UModal>

      <UModal
        v-if="book"
        v-model:open="isRecordDeletionDialogOpen"
        title="Delete this book?"
        description="This removes the book from your library history."
        :close="false"
        :ui="{ content: 'max-w-md', footer: 'justify-end gap-2 p-5' }"
      >
        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            @click="() => { isRecordDeletionDialogOpen = false }"
          >
            Cancel
          </UButton>
          <UButton
            color="error"
            variant="subtle"
            icon="i-lucide-trash-2"
            :loading="isDeleting"
            @click="deleteBookRecord"
          >
            Delete this book
          </UButton>
        </template>
      </UModal>

      <UModal
        v-model:open="isLoanRemovalDialogOpen"
        title="Remove a lent-out book?"
        description="This book will leave your library, but its active loan and borrower history will remain."
        :ui="{ footer: 'justify-end gap-3' }"
      >
        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            @click="() => { isLoanRemovalDialogOpen = false }"
          >
            Cancel
          </UButton>
          <UButton
            color="error"
            variant="subtle"
            icon="i-lucide-trash-2"
            :loading="isDeleting"
            @click="removeBook(true)"
          >
            Remove from Library
          </UButton>
        </template>
      </UModal>
    </UPageBody>
  </UContainer>
</template>
