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

      <!-- Book detail: cover-side title, persistent summary, and action cards. -->
      <template v-else>
        <div class="grid gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-8">
          <aside class="lg:sticky lg:top-24 lg:self-start">
            <div class="mx-auto max-w-70 space-y-4 lg:mx-0 lg:max-w-none">
              <div class="border border-default bg-default">
                <NuxtImg
                  v-if="coverUrl"
                  :src="coverUrl"
                  :alt="book.title"
                  width="280"
                  height="420"
                  preload
                  class="aspect-2/3 w-full object-cover"
                />
                <div
                  v-else
                  class="flex aspect-2/3 items-center justify-center bg-muted"
                >
                  <UIcon
                    name="i-lucide-book"
                    class="text-6xl text-muted"
                  />
                </div>
              </div>

              <section
                class="border border-default bg-default p-4"
                aria-labelledby="at-a-glance-heading"
              >
                <h2
                  id="at-a-glance-heading"
                  class="text-sm font-bold uppercase tracking-wide"
                >
                  At a glance
                </h2>
                <dl class="mt-4 space-y-3 text-sm">
                  <div class="flex items-start justify-between gap-4">
                    <dt class="flex items-center gap-2 text-muted">
                      <UIcon
                        name="i-lucide-box"
                        class="size-4 shrink-0"
                      />
                      Status
                    </dt>
                    <dd class="text-right font-medium">
                      {{ isOwnedBook ? (book.activeLoan ? 'Lent out' : 'Available') : book.libraryState === 'wishlisted' ? 'Wishlist' : 'Previously owned' }}
                    </dd>
                  </div>
                  <div class="flex items-start justify-between gap-4">
                    <dt class="flex items-center gap-2 text-muted">
                      <UIcon
                        name="i-lucide-map-pin"
                        class="size-4 shrink-0"
                      />
                      Location
                    </dt>
                    <dd class="max-w-36 text-right font-medium">
                      {{ isOwnedBook ? (book.location?.path || 'Not set') : book.lastKnownLocation || 'Not in inventory' }}
                    </dd>
                  </div>
                  <div class="flex items-start justify-between gap-4">
                    <dt class="flex items-center gap-2 text-muted">
                      <UIcon
                        name="i-lucide-book-open"
                        class="size-4 shrink-0"
                      />
                      Reading
                    </dt>
                    <dd class="text-right font-medium">
                      {{ isOwnedBook ? (book.readingProgress.status === 'read' ? 'Finished' : book.readingProgress.status === 'reading' ? 'In progress' : 'Not started') : 'Unavailable' }}
                    </dd>
                  </div>
                  <div class="flex items-start justify-between gap-4">
                    <dt class="flex items-center gap-2 text-muted">
                      <UIcon
                        name="i-lucide-handshake"
                        class="size-4 shrink-0"
                      />
                      Loan
                    </dt>
                    <dd class="text-right font-medium">
                      {{ book.activeLoan ? 'Lent out' : isOwnedBook ? 'Not on loan' : 'Not available' }}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </aside>

          <div class="space-y-4">
            <div class="space-y-4">
              <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <h1 class="text-3xl font-bold tracking-tight md:text-4xl">
                    {{ book.title }}
                  </h1>
                  <div class="mt-2 text-lg text-muted">
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
                <div class="flex shrink-0 flex-wrap gap-2">
                  <UButton
                    v-if="isOwnedBook"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    icon="i-lucide-map-pin"
                    @click="() => { isLocationModalOpen = true }"
                  >
                    Location
                  </UButton>
                  <UButton
                    v-if="isOwnedBook && book.activeLoan"
                    size="sm"
                    icon="i-lucide-undo-2"
                    :loading="isReturningLoan"
                    :disabled="isReturningLoan"
                    @click="returnActiveLoan"
                  >
                    Mark returned
                  </UButton>
                  <UButton
                    v-else-if="isOwnedBook"
                    size="sm"
                    icon="i-lucide-handshake"
                    @click="() => { isLendingModalOpen = true }"
                  >
                    Record loan
                  </UButton>
                  <UButton
                    v-else-if="book.libraryState === 'wishlisted'"
                    size="sm"
                    icon="i-lucide-arrow-up-right"
                    :loading="isUpdatingLibraryState"
                    :disabled="isUpdatingLibraryState"
                    @click="() => { isMoveToLibraryDialogOpen = true }"
                  >
                    Move to Library
                  </UButton>
                  <UButton
                    v-else
                    size="sm"
                    icon="i-lucide-arrow-up-right"
                    :loading="isUpdatingLibraryState"
                    :disabled="isUpdatingLibraryState"
                    @click="updateBookLibraryState('owned')"
                  >
                    Move to Library
                  </UButton>
                  <UDropdownMenu
                    :items="[
                      ...(isOwnedBook && !book.activeLoan ? [{ label: 'Move to Wishlist', icon: 'i-lucide-bookmark', onSelect: () => { isMoveToWishlistDialogOpen = true } }] : []),
                      ...(isOwnedBook ? [{ label: 'No longer own this book', icon: 'i-lucide-history', onSelect: () => { isOwnershipDialogOpen = true } }] : []),
                      ...(book.libraryState === 'wishlisted' ? [{ label: 'Remove from Wishlist', icon: 'i-lucide-x', color: 'error' as const, onSelect: () => { isWishlistRemovalDialogOpen = true } }] : []),
                      ...(book.libraryState === 'previously_owned' ? [{ label: 'Delete this book', icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => { isRecordDeletionDialogOpen = true } }] : [])
                    ]"
                  >
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
                  v-if="formattedPublishDate"
                  class="inline-flex items-center gap-1.5"
                ><UIcon
                  name="i-lucide-calendar-days"
                  class="size-4"
                /> Published {{ formattedPublishDate }}</span>
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
                <span
                  v-if="formattedAddedAt"
                  class="inline-flex items-center gap-1.5"
                ><UIcon
                  name="i-lucide-plus-circle"
                  class="size-4"
                /> Added {{ formattedAddedAt }}</span>
              </div>

              <div
                v-if="book.description"
                class="max-w-3xl pt-1"
              >
                <h2 class="mb-2 text-lg font-semibold">
                  Description
                </h2>
                <BookDescription :description="book.description" />
              </div>
              <div
                v-if="showOpenLibraryLinks && (book.openLibraryKey || book.workKey)"
                class="flex flex-wrap gap-2"
              >
                <UButton
                  v-if="book.openLibraryKey"
                  color="neutral"
                  variant="link"
                  size="sm"
                  icon="i-lucide-external-link"
                  :href="`https://openlibrary.org${book.openLibraryKey}`"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Edition
                </UButton>
                <UButton
                  v-if="book.workKey"
                  color="neutral"
                  variant="link"
                  size="sm"
                  icon="i-lucide-library"
                  :href="`https://openlibrary.org${book.workKey}`"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Work
                </UButton>
              </div>
              <UButton
                :to="`/library/compare/${userBookId}`"
                color="neutral"
                variant="link"
                size="sm"
                icon="i-lucide-columns-2"
              >
                Compare alternate layout
              </UButton>
            </div>

            <section
              class="border border-default border-l-4 border-l-emerald-500/70 bg-emerald-500/[0.03] p-5 md:p-6"
              aria-labelledby="loan-heading"
            >
              <div class="flex items-start gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center border border-emerald-500/30 bg-emerald-500/10">
                  <UIcon
                    name="i-lucide-handshake"
                    class="size-5 text-emerald-700 dark:text-emerald-300"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <h2
                    id="loan-heading"
                    class="text-lg font-semibold"
                  >
                    Loan
                  </h2>
                  <template v-if="isOwnedBook">
                    <div class="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div class="space-y-1 text-sm">
                        <template v-if="book.activeLoan">
                          <p class="font-medium">
                            Lent to {{ book.activeLoan.acceptedByName || book.activeLoan.borrowerDisplayName }}
                            <template v-if="book.activeLoan.acceptedByName && book.activeLoan.acceptedByName !== book.activeLoan.borrowerDisplayName">
                              · entered as {{ book.activeLoan.borrowerDisplayName }}
                            </template>
                          </p>
                          <p
                            v-if="book.activeLoan.dueAt"
                            class="text-muted"
                          >
                            Lent {{ formatDate(book.activeLoan.loanedAt) }} · Due {{ formatDate(book.activeLoan.dueAt) }}
                          </p>
                          <p
                            v-else
                            class="text-muted"
                          >
                            Lent {{ formatDate(book.activeLoan.loanedAt) }}
                          </p>
                        </template>
                        <p
                          v-else
                          class="text-muted"
                        >
                          This copy is available to lend<template v-if="book.location">
                            · {{ book.location.path }}
                          </template>.
                        </p>
                      </div>
                      <UButton
                        :color="book.activeLoan ? 'neutral' : 'primary'"
                        :variant="book.activeLoan ? 'outline' : 'soft'"
                        size="sm"
                        :icon="book.activeLoan ? 'i-lucide-undo-2' : 'i-lucide-handshake'"
                        :loading="isReturningLoan"
                        :disabled="isReturningLoan"
                        @click="book.activeLoan ? returnActiveLoan() : (isLendingModalOpen = true)"
                      >
                        {{ book.activeLoan ? 'Mark returned' : 'Lend this book' }}
                      </UButton>
                    </div>
                  </template>
                  <p
                    v-else-if="book.libraryState === 'wishlisted'"
                    class="mt-2 text-sm text-muted"
                  >
                    This title is on your wishlist, so it is not available to lend yet.
                  </p>
                  <p
                    v-else
                    class="mt-2 text-sm text-muted"
                  >
                    This copy is kept in your history and is no longer available to lend<template v-if="book.lastKnownLocation">
                      · last seen at {{ book.lastKnownLocation }}
                    </template>.
                  </p>
                </div>
              </div>
            </section>

            <section
              v-if="isOwnedBook"
              class="border border-default border-l-4 border-l-primary/70 bg-primary/[0.03] p-5 md:p-6"
              aria-labelledby="reading-heading"
            >
              <div class="flex items-start gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10">
                  <UIcon
                    name="i-lucide-book-open"
                    class="size-5 text-primary"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <h2
                    id="reading-heading"
                    class="sr-only"
                  >
                    Reading
                  </h2>
                  <BookReadingProgress
                    :progress="book.readingProgress"
                    :total-pages="book.numberOfPages"
                    @edit="isReadingModalOpen = true"
                  />
                  <USeparator class="my-4" />
                  <BookRating
                    :rating="book.rating"
                    @update:rating="saveRating"
                  />
                </div>
              </div>
            </section>

            <section
              class="border border-default border-l-4 border-l-amber-500/70 bg-amber-500/[0.03] p-5 md:p-6"
              aria-labelledby="note-heading"
            >
              <div class="flex items-start gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center border border-amber-500/30 bg-amber-500/10">
                  <UIcon
                    name="i-lucide-notebook-pen"
                    class="size-5 text-amber-700 dark:text-amber-300"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <h2
                    id="note-heading"
                    class="sr-only"
                  >
                    Personal note
                  </h2>
                  <BookNote
                    :note="book.note"
                    @update:note="saveNote"
                  />
                </div>
              </div>
            </section>

            <section
              class="border border-default border-l-4 border-l-violet-500/70 bg-violet-500/[0.03] p-5 md:p-6"
              aria-labelledby="tags-heading"
            >
              <div class="flex items-start gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center border border-violet-500/30 bg-violet-500/10">
                  <UIcon
                    name="i-lucide-tag"
                    class="size-5 text-violet-700 dark:text-violet-300"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h2
                        id="tags-heading"
                        class="text-lg font-semibold"
                      >
                        Tags
                      </h2>
                      <p
                        v-if="book.userTags.length === 0"
                        class="mt-1 text-sm text-muted"
                      >
                        Add tags to make this book easier to find and group.
                      </p>
                    </div>
                    <UButton
                      color="neutral"
                      variant="link"
                      size="sm"
                      icon="i-lucide-pencil"
                      @click="openTagModal"
                    >
                      {{ book.userTags.length ? 'Edit tags' : 'Add tags' }}
                    </UButton>
                  </div>
                  <div
                    v-if="book.userTags.length"
                    class="mt-3 flex flex-wrap gap-2"
                  >
                    <UBadge
                      v-for="tag in book.userTags"
                      :key="tag.id"
                      color="secondary"
                      variant="subtle"
                      size="md"
                    >
                      {{ tag.name }}
                    </UBadge>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </template>

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
