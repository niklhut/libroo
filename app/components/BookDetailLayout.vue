<script setup lang="ts">
import { booleanConfigValue } from '~~/shared/utils/runtime-config'

defineOptions({ name: 'BookDetailLayout' })

const route = useRoute()
const config = useRuntimeConfig()
const toast = useToast()
const userBookId = route.params.id as string

const isDeleting = ref(false)
const isLocationModalOpen = ref(false)
const isLendingModalOpen = ref(false)
const isReadingModalOpen = ref(false)
const isTagModalOpen = ref(false)
const isBookNoteModalOpen = ref(false)
const isLoanNoteModalOpen = ref(false)
const isReturningLoan = ref(false)
const isSavingReadingProgress = ref(false)
const isSavingBookNote = ref(false)
const isSavingLoanNote = ref(false)
const isSavingRating = ref(false)
const isLoanRemovalDialogOpen = ref(false)
const isOwnershipDialogOpen = ref(false)
const isWishlistRemovalDialogOpen = ref(false)
const isRecordDeletionDialogOpen = ref(false)
const isMoveToWishlistDialogOpen = ref(false)
const isMoveToLibraryDialogOpen = ref(false)
const isUpdatingLibraryState = ref(false)
const bookNoteDraft = ref('')
const loanNoteDraft = ref('')

const { data: book, status, refresh } = await useFetch<BookDetails>(`/api/books/${userBookId}`, {
  headers: useRequestHeaders(['cookie'])
})

usePageTitle(computed(() => book.value ? `${book.value.title} · Layout preview` : 'Layout preview'))

const coverUrl = computed(() => book.value?.coverPath ? `/api/blob/${book.value.coverPath}` : null)
const isOwnedBook = computed(() => book.value?.libraryState === 'owned')
const showOpenLibraryLinks = computed(() =>
  booleanConfigValue(config.public.openLibraryLinksEnabled, false)
)
const readingPercent = computed(() => {
  const progress = book.value?.readingProgress
  if (!progress) return 0
  if (progress.currentPage !== null && book.value?.numberOfPages) {
    return Math.min(100, Math.round((progress.currentPage / book.value.numberOfPages) * 100))
  }
  return progress.progressPercent ?? 0
})
const readingSummary = computed(() => {
  const progress = book.value?.readingProgress
  if (!progress) return ''
  if (progress.status === 'read') return 'Read · Finished'
  if (progress.status === 'reading') {
    return progress.currentPage !== null && book.value?.numberOfPages
      ? `Reading · ${progress.currentPage} of ${book.value.numberOfPages} pages`
      : `Reading · ${progress.progressPercent ?? 0}% complete`
  }
  return 'Unread · Not started'
})

function formatDate(value: Date | string | null): string | null {
  if (!value) return null
  if (typeof value === 'string' && /^\d{4}$/.test(value)) return value
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function openBookNote() {
  bookNoteDraft.value = book.value?.note ?? ''
  isBookNoteModalOpen.value = true
}

function openLoanNote() {
  loanNoteDraft.value = book.value?.activeLoan?.note ?? ''
  isLoanNoteModalOpen.value = true
}

async function removeBook(confirmActiveLoan = false) {
  isDeleting.value = true
  try {
    await $fetch(`/api/books/${userBookId}`, {
      method: 'DELETE',
      query: confirmActiveLoan ? { confirmActiveLoan: 'true' } : undefined
    })
    toast.add({ title: 'Book removed', color: 'success' })
    await navigateTo('/library')
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number, data?: { statusCode?: number } })?.statusCode
      ?? (error as { data?: { statusCode?: number } })?.data?.statusCode
    if (statusCode === 409 && book.value?.activeLoan && !confirmActiveLoan) {
      isLoanRemovalDialogOpen.value = true
      return
    }
    toast.add({ title: 'Could not remove book', color: 'error' })
  } finally {
    isDeleting.value = false
  }
}

async function updateBookLibraryState(state: LibraryState) {
  if (!book.value || isUpdatingLibraryState.value) return
  isUpdatingLibraryState.value = true
  try {
    await $fetch(`/api/books/${userBookId}/state`, {
      method: 'PUT',
      body: { state }
    })
    await refresh()
    toast.add({
      title: state === 'owned' ? 'Moved to library' : state === 'wishlisted' ? 'Moved to wishlist' : 'Marked previously owned',
      color: 'success'
    })
  } catch {
    toast.add({ title: 'Could not update book state', color: 'error' })
  } finally {
    isUpdatingLibraryState.value = false
  }
}

function moveToWishlist() {
  isMoveToWishlistDialogOpen.value = false
  void updateBookLibraryState('wishlisted')
}

function moveToLibrary() {
  isMoveToLibraryDialogOpen.value = false
  void updateBookLibraryState('owned')
}

function markAsPreviouslyOwned() {
  isOwnershipDialogOpen.value = false
  void updateBookLibraryState('previously_owned')
}

function deleteBookRecord() {
  isOwnershipDialogOpen.value = false
  isWishlistRemovalDialogOpen.value = false
  isRecordDeletionDialogOpen.value = false
  void removeBook()
}

async function saveBookNote() {
  if (!book.value) return
  isSavingBookNote.value = true
  try {
    await $fetch(`/api/books/${userBookId}/note`, {
      method: 'PUT',
      body: { note: bookNoteDraft.value.trim() || null }
    })
    await refresh()
    isBookNoteModalOpen.value = false
    toast.add({ title: bookNoteDraft.value.trim() ? 'Note saved' : 'Note removed', color: 'success' })
  } catch {
    toast.add({ title: 'Could not save note', color: 'error' })
  } finally {
    isSavingBookNote.value = false
  }
}

async function saveLoanNote() {
  const loan = book.value?.activeLoan
  if (!loan) return
  isSavingLoanNote.value = true
  try {
    await $fetch(`/api/loans/${loan.id}/note`, {
      method: 'PUT',
      body: { note: loanNoteDraft.value.trim() || null }
    })
    await refresh()
    isLoanNoteModalOpen.value = false
    toast.add({ title: loanNoteDraft.value.trim() ? 'Loan note saved' : 'Loan note removed', color: 'success' })
  } catch {
    toast.add({ title: 'Could not save loan note', color: 'error' })
  } finally {
    isSavingLoanNote.value = false
  }
}

async function returnActiveLoan() {
  const loan = book.value?.activeLoan
  if (!loan || isReturningLoan.value) return
  isReturningLoan.value = true
  try {
    await $fetch(`/api/loans/${loan.id}/return`, { method: 'POST' })
    await refresh()
    toast.add({ title: 'Book marked as returned', color: 'success' })
  } catch {
    toast.add({ title: 'Could not update lending status', color: 'error' })
  } finally {
    isReturningLoan.value = false
  }
}

async function saveReadingProgress(progress: ReadingProgress) {
  isSavingReadingProgress.value = true
  try {
    await $fetch(`/api/books/${userBookId}/reading`, { method: 'PUT', body: progress })
    await refresh()
    isReadingModalOpen.value = false
    toast.add({ title: 'Progress saved', color: 'success' })
  } catch {
    toast.add({ title: 'Could not save reading progress', color: 'error' })
  } finally {
    isSavingReadingProgress.value = false
  }
}

async function saveRating(rating: number | null) {
  if (!book.value || isSavingRating.value) return
  const previousRating = book.value.rating
  book.value = { ...book.value, rating }
  isSavingRating.value = true
  try {
    await $fetch(`/api/books/${userBookId}/rating`, { method: 'PUT', body: { rating } })
  } catch {
    book.value = { ...book.value, rating: previousRating }
    toast.add({ title: 'Could not save rating', color: 'error' })
  } finally {
    isSavingRating.value = false
  }
}

async function onLocationSaved(location: BookLocation | null) {
  if (book.value) book.value = { ...book.value, location }
  await refresh()
}

async function onLoanSaved() {
  await refresh()
}

async function onTagsSaved() {
  await refresh()
}
</script>

<template>
  <UContainer>
    <UPageBody>
      <div
        v-if="status === 'pending' && !book"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <UCard
        v-else-if="!book"
        class="py-12 text-center"
      >
        <h1 class="text-xl font-semibold">
          Book not found
        </h1>
        <UButton
          to="/library"
          class="mt-4"
        >
          Back to Library
        </UButton>
      </UCard>

      <template v-else>
        <div class="grid gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-8">
          <aside class="lg:sticky lg:top-24 lg:self-start">
            <div class="w-full space-y-4 sm:grid sm:grid-cols-[17.5rem_minmax(0,1fr)] sm:items-start sm:gap-6 sm:space-y-0 lg:block lg:space-y-4">
              <div class="mx-auto w-full max-w-70 border border-default bg-default sm:mx-0 sm:col-start-1 lg:col-auto">
                <NuxtImg
                  v-if="coverUrl"
                  :src="coverUrl"
                  :alt="book.title"
                  width="280"
                  height="420"
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
                class="border border-default bg-default p-4 sm:col-start-2 sm:row-start-1 lg:col-auto"
                aria-labelledby="preview-summary-heading"
              >
                <h2
                  id="preview-summary-heading"
                  class="text-sm font-bold uppercase tracking-wide"
                >
                  At a glance
                </h2>
                <dl class="mt-4 space-y-3 text-sm">
                  <div class="flex items-start justify-between gap-4">
                    <dt class="flex items-center gap-2 text-muted">
                      <UIcon
                        name="i-lucide-box"
                        class="size-4"
                      />Status
                    </dt><dd class="text-right font-medium">
                      {{ isOwnedBook ? (book.activeLoan ? 'Lent out' : 'Available') : book.libraryState === 'wishlisted' ? 'Wishlist' : 'Previously owned' }}
                    </dd>
                  </div>
                  <div
                    v-if="isOwnedBook"
                    class="flex items-start justify-between gap-4"
                  >
                    <dt class="flex items-center gap-2 text-muted">
                      <UIcon
                        name="i-lucide-map-pin"
                        class="size-4"
                      />Location
                    </dt><dd class="max-w-36 text-right font-medium">
                      {{ isOwnedBook ? book.location?.path || 'Not set' : book.lastKnownLocation || 'Not in inventory' }}
                    </dd>
                  </div>
                  <div
                    v-if="isOwnedBook"
                    class="flex items-start justify-between gap-4"
                  >
                    <dt class="flex items-center gap-2 text-muted">
                      <UIcon
                        name="i-lucide-book-open"
                        class="size-4"
                      />Reading
                    </dt><dd class="max-w-36 text-right font-medium">
                      {{ isOwnedBook ? readingSummary : 'Unavailable' }}
                    </dd>
                  </div>
                  <div
                    v-if="isOwnedBook"
                    class="flex items-start justify-between gap-4"
                  >
                    <dt class="flex items-center gap-2 text-muted">
                      <UIcon
                        name="i-lucide-star"
                        class="size-4"
                      />Rating
                    </dt><dd class="flex min-h-5 items-center justify-end gap-0.5">
                      <template v-if="isOwnedBook && book.rating">
                        <UIcon
                          v-for="star in 5"
                          :key="star"
                          name="i-lucide-star"
                          :class="star <= book.rating ? 'size-4 fill-amber-400 text-amber-500' : 'size-4 text-muted'"
                        />
                      </template>
                      <span
                        v-else
                        class="font-medium"
                      >{{ isOwnedBook ? 'Not rated' : 'Unavailable' }}</span>
                    </dd>
                  </div>
                </dl>
              </section>
            </div>
          </aside>

          <main class="flex flex-col gap-4">
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
                    @click="isMoveToLibraryDialogOpen = true"
                  >
                    Move to Library
                  </UButton>
                  <UButton
                    v-else-if="book.libraryState === 'previously_owned'"
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
                </h2><BookDescription :description="book.description" />
              </div>
            </header>

            <section
              v-if="isOwnedBook"
              class="order-4 border border-default border-l-4 border-l-primary/70 bg-primary/[0.015] p-5"
              aria-labelledby="preview-location-heading"
            >
              <div class="flex gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10">
                  <UIcon
                    name="i-lucide-map-pin"
                    class="size-5 text-primary"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h2
                        id="preview-location-heading"
                        class="text-lg font-semibold"
                      >
                        Location
                      </h2><p class="mt-1 text-sm text-muted">
                        Where this physical copy belongs.
                      </p>
                    </div>
                    <UButton
                      v-if="isOwnedBook"
                      color="primary"
                      variant="link"
                      size="sm"
                      icon="i-lucide-pencil"
                      @click="isLocationModalOpen = true"
                    >
                      Update
                    </UButton>
                  </div>
                  <p class="mt-4 font-medium">
                    {{ book.location?.path || 'No location set' }}
                  </p>
                </div>
              </div>
            </section>

            <section
              v-if="isOwnedBook"
              :class="[book.activeLoan ? 'order-1' : 'order-6', 'border border-default border-l-4 border-l-emerald-500/70 bg-emerald-500/[0.03] p-5']"
              aria-labelledby="preview-loan-heading"
            >
              <div class="flex gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center border border-emerald-500/30 bg-emerald-500/10">
                  <UIcon
                    name="i-lucide-handshake"
                    class="size-5 text-emerald-700 dark:text-emerald-300"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h2
                        id="preview-loan-heading"
                        class="text-lg font-semibold"
                      >
                        Loan
                      </h2><p class="mt-1 text-sm text-muted">
                        {{ book.activeLoan ? `Lent to ${book.activeLoan.acceptedByName || book.activeLoan.borrowerDisplayName}` : isOwnedBook ? 'This copy is currently available to lend.' : 'Lending is available once this is in your library.' }}
                      </p>
                    </div>
                    <template v-if="isOwnedBook">
                      <div
                        v-if="book.activeLoan"
                        class="flex items-center gap-2"
                      >
                        <UButton
                          color="primary"
                          variant="link"
                          size="sm"
                          icon="i-lucide-undo-2"
                          :loading="isReturningLoan"
                          @click="returnActiveLoan"
                        >
                          Mark returned
                        </UButton>
                        <UDropdownMenu :items="[{ label: 'Edit loan note', icon: 'i-lucide-notebook-pen', onSelect: openLoanNote }]">
                          <UButton
                            color="primary"
                            variant="link"
                            size="sm"
                            icon="i-lucide-ellipsis"
                            aria-label="More loan actions"
                          />
                        </UDropdownMenu>
                      </div>
                      <UButton
                        v-else
                        color="primary"
                        variant="link"
                        size="sm"
                        icon="i-lucide-handshake"
                        @click="isLendingModalOpen = true"
                      >
                        Lend this book
                      </UButton>
                    </template>
                  </div>
                  <div
                    v-if="book.activeLoan"
                    class="mt-4 space-y-2 text-sm"
                  >
                    <p class="text-muted">
                      Lent {{ formatDate(book.activeLoan.loanedAt) }}<template v-if="book.activeLoan.dueAt">
                        · Due {{ formatDate(book.activeLoan.dueAt) }}
                      </template>
                    </p><div
                      v-if="book.activeLoan.note"
                      class="border-l-2 border-emerald-500/60 pl-3"
                    >
                      <p class="text-xs font-bold uppercase tracking-wide text-muted">
                        Loan note
                      </p><p class="mt-1 whitespace-pre-wrap">
                        {{ book.activeLoan.note }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section
              v-if="isOwnedBook"
              class="order-2 border border-default border-l-4 border-l-primary/70 bg-primary/[0.03] p-5"
              aria-labelledby="preview-reading-heading"
            >
              <div class="flex gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center border border-primary/30 bg-primary/10">
                  <UIcon
                    name="i-lucide-book-open"
                    class="size-5 text-primary"
                  />
                </div><div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h2
                        id="preview-reading-heading"
                        class="text-lg font-semibold"
                      >
                        Reading progress
                      </h2><p class="mt-1 text-sm text-muted">
                        {{ readingSummary }}
                      </p>
                    </div><UButton
                      color="primary"
                      variant="link"
                      size="sm"
                      icon="i-lucide-pencil"
                      @click="isReadingModalOpen = true"
                    >
                      Update
                    </UButton>
                  </div><UProgress
                    :model-value="readingPercent"
                    :max="100"
                    class="mt-4"
                  />
                </div>
              </div>
              <div class="mt-4 grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 border-t border-default pt-4">
                <div class="flex size-10 items-center justify-center border border-primary/30 bg-primary/10">
                  <UIcon
                    name="i-lucide-star"
                    class="size-5 text-primary"
                  />
                </div>
                <BookRating
                  :rating="book.rating"
                  :show-value="false"
                  compact
                  @update:rating="saveRating"
                />
              </div>
            </section>

            <section
              class="order-3 border border-default border-l-4 border-l-amber-500/70 bg-amber-500/[0.03] p-5"
              aria-labelledby="preview-note-heading"
            >
              <div class="flex gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center border border-amber-500/30 bg-amber-500/10">
                  <UIcon
                    name="i-lucide-notebook-pen"
                    class="size-5 text-amber-700 dark:text-amber-300"
                  />
                </div><div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h2
                        id="preview-note-heading"
                        class="text-lg font-semibold"
                      >
                        Personal note
                      </h2><p class="mt-1 whitespace-pre-wrap text-sm text-muted">
                        {{ book.note || 'Add thoughts, quotes, or anything you want to remember.' }}
                      </p>
                    </div><UButton
                      color="primary"
                      variant="link"
                      size="sm"
                      :icon="book.note ? 'i-lucide-pencil' : 'i-lucide-plus'"
                      @click="openBookNote"
                    >
                      {{ book.note ? 'Edit' : 'Add note' }}
                    </UButton>
                  </div>
                </div>
              </div>
            </section>

            <section
              class="order-5 border border-default border-l-4 border-l-violet-500/70 bg-violet-500/[0.03] p-5"
              aria-labelledby="preview-tags-heading"
            >
              <div class="flex gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center border border-violet-500/30 bg-violet-500/10">
                  <UIcon
                    name="i-lucide-tag"
                    class="size-5 text-violet-700 dark:text-violet-300"
                  />
                </div><div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-3">
                    <div>
                      <h2
                        id="preview-tags-heading"
                        class="text-lg font-semibold"
                      >
                        Tags
                      </h2><p
                        v-if="book.userTags.length === 0"
                        class="mt-1 text-sm text-muted"
                      >
                        Add tags to make this book easier to find and group.
                      </p>
                    </div><UButton
                      color="primary"
                      variant="link"
                      size="sm"
                      icon="i-lucide-pencil"
                      @click="isTagModalOpen = true"
                    >
                      {{ book.userTags.length ? 'Edit tags' : 'Add tags' }}
                    </UButton>
                  </div><div
                    v-if="book.userTags.length"
                    class="mt-3 flex flex-wrap gap-2"
                  >
                    <UBadge
                      v-for="tag in book.userTags"
                      :key="tag.id"
                      color="secondary"
                      variant="subtle"
                    >
                      {{ tag.name }}
                    </UBadge>
                  </div>
                </div>
              </div>
            </section>

            <div
              v-if="showOpenLibraryLinks && (book.openLibraryKey || book.workKey)"
              class="order-7 flex flex-wrap gap-2 pt-1"
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
          </main>
        </div>

        <BookLocationModal
          v-if="isOwnedBook"
          v-model:open="isLocationModalOpen"
          :user-book-id="userBookId"
          :current-location="book.location"
          @saved="onLocationSaved"
        />
        <BookLendingModal
          v-if="isOwnedBook"
          v-model:open="isLendingModalOpen"
          :user-book-id="userBookId"
          @saved="onLoanSaved"
        />
        <BookReadingProgressModal
          v-if="isOwnedBook"
          v-model:open="isReadingModalOpen"
          :progress="book.readingProgress"
          :total-pages="book.numberOfPages"
          :saving="isSavingReadingProgress"
          @save:progress="saveReadingProgress"
        />
        <TagManagerModal
          v-model:open="isTagModalOpen"
          :user-book-id="userBookId"
          :user-tags="book.userTags"
          :suggested-tags="book.suggestedTags"
          @saved="onTagsSaved"
        />

        <UModal
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
              @click="isMoveToWishlistDialogOpen = false"
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
              @click="isMoveToLibraryDialogOpen = false"
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
          v-model:open="isOwnershipDialogOpen"
          title="No longer own this book?"
          :description="book.activeLoan
            ? 'This book has an active loan, so it cannot be marked previously owned until the loan is returned. You can delete this book instead.'
            : 'Keep this book as previously owned, or delete this book.'"
          :close="false"
          :ui="{ content: 'max-w-md', footer: 'flex-wrap justify-end gap-2 p-5' }"
        >
          <template #footer>
            <UButton
              color="neutral"
              variant="soft"
              @click="isOwnershipDialogOpen = false"
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
              @click="isWishlistRemovalDialogOpen = false"
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
              @click="isRecordDeletionDialogOpen = false"
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
              @click="isLoanRemovalDialogOpen = false"
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

        <UModal
          v-model:open="isBookNoteModalOpen"
          title="Personal note"
          :ui="{ footer: 'justify-end gap-2' }"
        >
          <template #body>
            <UTextarea
              v-model="bookNoteDraft"
              autofocus
              :rows="6"
              placeholder="Write your note here..."
              class="w-full"
            />
          </template><template #footer>
            <UButton
              color="neutral"
              variant="outline"
              @click="isBookNoteModalOpen = false"
            >
              Cancel
            </UButton><UButton
              :loading="isSavingBookNote"
              @click="saveBookNote"
            >
              Save note
            </UButton>
          </template>
        </UModal>
        <UModal
          v-model:open="isLoanNoteModalOpen"
          title="Loan note"
          :ui="{ footer: 'justify-end gap-2' }"
        >
          <template #body>
            <UTextarea
              v-model="loanNoteDraft"
              autofocus
              :rows="6"
              placeholder="Add a private note about this loan..."
              class="w-full"
            />
          </template><template #footer>
            <UButton
              color="neutral"
              variant="outline"
              @click="isLoanNoteModalOpen = false"
            >
              Cancel
            </UButton><UButton
              :loading="isSavingLoanNote"
              @click="saveLoanNote"
            >
              Save note
            </UButton>
          </template>
        </UModal>
      </template>
    </UPageBody>
  </UContainer>
</template>
