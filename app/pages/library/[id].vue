<script setup lang="ts">
import { booleanConfigValue } from '~~/shared/utils/runtime-config'

const route = useRoute()
const config = useRuntimeConfig()
const userBookId = route.params.id as string

const isLocationModalOpen = ref(false)
const isLendingModalOpen = ref(false)
const isReadingModalOpen = ref(false)
const isTagModalOpen = ref(false)
const isBookNoteModalOpen = ref(false)
const isLoanNoteModalOpen = ref(false)
const isLoanRemovalDialogOpen = ref(false)
const isOwnershipDialogOpen = ref(false)
const isWishlistRemovalDialogOpen = ref(false)
const isRecordDeletionDialogOpen = ref(false)
const isMoveToWishlistDialogOpen = ref(false)
const isMoveToLibraryDialogOpen = ref(false)
const bookNoteDraft = ref('')
const loanNoteDraft = ref('')

const { data: book, status, refresh } = await useFetch<BookDetails>(`/api/books/${userBookId}`, {
  headers: useRequestHeaders(['cookie'])
})

usePageTitle(computed(() => book.value?.title ?? 'Book'))

const {
  isDeleting,
  isReturningLoan,
  isSavingReadingProgress,
  isSavingBookNote,
  isSavingLoanNote,
  isUpdatingLibraryState,
  removeBook,
  updateBookLibraryState,
  saveBookNote: persistBookNote,
  saveLoanNote: persistLoanNote,
  returnActiveLoan,
  saveReadingProgress: persistReadingProgress,
  saveRating
} = useBookDetailActions(userBookId, book, refresh)

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

function moveToWishlist() {
  isMoveToWishlistDialogOpen.value = false
  void updateBookLibraryState('wishlisted')
}

function moveToLibrary() {
  isMoveToLibraryDialogOpen.value = false
  void updateBookLibraryState('owned')
}

function requestMoveToLibrary() {
  if (book.value?.libraryState === 'wishlisted') {
    isMoveToLibraryDialogOpen.value = true
    return
  }
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
  void removeBook().then((result) => {
    if (result === 'active-loan') isLoanRemovalDialogOpen.value = true
  })
}

function openBookNote() {
  bookNoteDraft.value = book.value?.note ?? ''
  isBookNoteModalOpen.value = true
}

function openLoanNote() {
  loanNoteDraft.value = book.value?.activeLoan?.note ?? ''
  isLoanNoteModalOpen.value = true
}

async function saveBookNote() {
  if (await persistBookNote(bookNoteDraft.value)) isBookNoteModalOpen.value = false
}

async function saveLoanNote() {
  if (await persistLoanNote(loanNoteDraft.value)) isLoanNoteModalOpen.value = false
}

async function saveReadingProgress(progress: ReadingProgress) {
  if (await persistReadingProgress(progress)) isReadingModalOpen.value = false
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
          <BookDetailSidebar :book="book" />

          <main class="flex flex-col gap-4">
            <BookDetailHeader
              :book="book"
              :is-deleting="isDeleting"
              :is-updating-library-state="isUpdatingLibraryState"
              :format-date="formatDate"
              @move-to-library="requestMoveToLibrary"
              @move-to-wishlist="isMoveToWishlistDialogOpen = true"
              @mark-previously-owned="isOwnershipDialogOpen = true"
              @remove-wishlist="isWishlistRemovalDialogOpen = true"
              @delete-record="isRecordDeletionDialogOpen = true"
            />

            <BookDetailCard
              v-if="isOwnedBook"
              class="order-4"
              title="Location"
              description="Where this physical copy belongs."
              icon="i-lucide-map-pin"
            >
              <template #action>
                <UButton
                  color="primary"
                  variant="link"
                  size="sm"
                  icon="i-lucide-pencil"
                  @click="isLocationModalOpen = true"
                >
                  Update
                </UButton>
              </template>
              <p class="mt-4 font-medium">
                {{ book.location?.path || 'No location set' }}
              </p>
            </BookDetailCard>

            <BookDetailCard
              v-if="isOwnedBook"
              :class="book.activeLoan ? 'order-1' : 'order-6'"
              title="Loan"
              :description="book.activeLoan ? `Lent to ${book.activeLoan.acceptedByName || book.activeLoan.borrowerDisplayName}` : 'This copy is currently available to lend.'"
              icon="i-lucide-handshake"
              tone="success"
            >
              <template #action>
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
              <div
                v-if="book.activeLoan"
                class="mt-4 space-y-2 text-sm"
              >
                <p class="text-muted">
                  Lent {{ formatDate(book.activeLoan.loanedAt) }}<template v-if="book.activeLoan.dueAt">
                    · Due {{ formatDate(book.activeLoan.dueAt) }}
                  </template>
                </p>
                <div
                  v-if="book.activeLoan.note"
                  class="border-l-2 border-emerald-500/60 pl-3"
                >
                  <p class="text-xs font-bold uppercase tracking-wide text-muted">
                    Loan note
                  </p>
                  <p class="mt-1 whitespace-pre-wrap">
                    {{ book.activeLoan.note }}
                  </p>
                </div>
              </div>
            </BookDetailCard>

            <BookDetailCard
              v-if="isOwnedBook"
              class="order-2"
              title="Reading progress"
              :description="readingSummary"
              icon="i-lucide-book-open"
            >
              <template #action>
                <UButton
                  color="primary"
                  variant="link"
                  size="sm"
                  icon="i-lucide-pencil"
                  @click="isReadingModalOpen = true"
                >
                  Update
                </UButton>
              </template>
              <UProgress
                :model-value="readingPercent"
                :max="100"
                class="mt-4"
              />
              <template #footer>
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
              </template>
            </BookDetailCard>

            <BookDetailCard
              class="order-3"
              title="Personal note"
              icon="i-lucide-notebook-pen"
              tone="warning"
            >
              <template #action>
                <UButton
                  color="primary"
                  variant="link"
                  size="sm"
                  :icon="book.note ? 'i-lucide-pencil' : 'i-lucide-plus'"
                  @click="openBookNote"
                >
                  {{ book.note ? 'Edit' : 'Add note' }}
                </UButton>
              </template>
              <p class="mt-1 whitespace-pre-wrap text-sm text-muted">
                {{ book.note || 'Add thoughts, quotes, or anything you want to remember.' }}
              </p>
            </BookDetailCard>

            <BookDetailCard
              class="order-5"
              title="Tags"
              icon="i-lucide-tag"
              tone="secondary"
            >
              <template #action>
                <UButton
                  color="primary"
                  variant="link"
                  size="sm"
                  icon="i-lucide-pencil"
                  @click="isTagModalOpen = true"
                >
                  {{ book.userTags.length ? 'Edit tags' : 'Add tags' }}
                </UButton>
              </template>
              <p
                v-if="book.userTags.length === 0"
                class="mt-1 text-sm text-muted"
              >
                Add tags to make this book easier to find and group.
              </p>
              <div
                v-else
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
            </BookDetailCard>

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
