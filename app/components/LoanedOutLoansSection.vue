<script setup lang="ts">
import type { OwnerLoan } from '~~/shared/types/book'
import { LOAN_NOTE_MAX_LENGTH } from '~~/shared/utils/loan'
import { formatDate, returnedLabel } from '~/utils/loan-date-helpers'

const props = defineProps<{
  loans: OwnerLoan[]
  returningLoanId: string | null
  cancellingLoanId: string | null
  deletingLoanId: string | null
}>()

const emit = defineEmits<{
  returnLoan: [loan: OwnerLoan]
  cancelLoan: [loan: OwnerLoan]
  deleteLoan: [loan: OwnerLoan]
  saveLoanNote: [loan: OwnerLoan, note: string | null]
}>()

const editingLoanId = ref<string | null>(null)
const draftNote = ref('')
const isDeleteLoanModalOpen = ref(false)
const deleteLoanTarget = ref<OwnerLoan | null>(null)

function editNote(loan: OwnerLoan) {
  editingLoanId.value = loan.id
  draftNote.value = loan.note ?? ''
}

function cancelNoteEdit() {
  editingLoanId.value = null
  draftNote.value = ''
}

function saveNote(loan: OwnerLoan) {
  emit('saveLoanNote', loan, draftNote.value.trim() || null)
  cancelNoteEdit()
}

function clearNote() {
  draftNote.value = ''
}

function openDeleteLoanModal(loan: OwnerLoan) {
  deleteLoanTarget.value = loan
  isDeleteLoanModalOpen.value = true
}

function cancelDeleteLoan() {
  isDeleteLoanModalOpen.value = false
  deleteLoanTarget.value = null
}

function confirmDeleteLoan() {
  if (!deleteLoanTarget.value) return
  emit('deleteLoan', deleteLoanTarget.value)
  isDeleteLoanModalOpen.value = false
}

const deleteLoanDescription = computed(() => {
  if (!deleteLoanTarget.value) return ''
  return deleteLoanTarget.value.acceptedAt
    ? 'This loan record will be permanently removed. It will also disappear from the borrower’s history.'
    : 'This loan record will be permanently removed.'
})

const activeLoans = computed(() => props.loans.filter(loan => loan.status === 'active'))
const loanHistory = computed(() => props.loans.filter(loan => loan.status !== 'active'))

function coverUrl(loan: OwnerLoan) {
  return loan.book.coverPath ? `/api/blob/${loan.book.coverPath}` : null
}

function borrowerLabel(loan: OwnerLoan) {
  if (!loan.acceptedByName || loan.acceptedByName === loan.borrowerDisplayName) {
    return loan.borrowerDisplayName
  }
  return `${loan.acceptedByName} · entered as ${loan.borrowerDisplayName}`
}

function openBook(loan: OwnerLoan) {
  return navigateTo(`/library/${loan.userBookId}`)
}
</script>

<template>
  <UCard
    v-if="loans.length === 0"
    class="text-center py-12"
  >
    <UIcon
      name="i-lucide-handshake"
      class="text-6xl text-muted mx-auto mb-4"
    />
    <h2 class="text-xl font-semibold mb-2">
      No loans yet
    </h2>
    <p class="text-muted">
      Books you record as loaned out will appear here.
    </p>
  </UCard>

  <div
    v-else
    class="space-y-8"
  >
    <section>
      <h2 class="text-lg font-semibold mb-3">
        Current
      </h2>
      <div
        v-if="activeLoans.length > 0"
        class="grid gap-4 md:grid-cols-2"
      >
        <UCard
          v-for="loan in activeLoans"
          :key="loan.id"
          variant="subtle"
          class="group cursor-pointer transition hover:ring-1 hover:ring-primary/30"
          role="link"
          tabindex="0"
          :aria-label="`Open ${loan.book.title}`"
          @click="openBook(loan)"
          @keydown.enter.self.prevent.stop="openBook(loan)"
          @keydown.space.self.prevent.stop="openBook(loan)"
        >
          <div class="flex gap-4">
            <div class="shrink-0">
              <NuxtImg
                v-if="coverUrl(loan)"
                :src="coverUrl(loan)!"
                :alt="loan.book.title"
                class="h-28 w-19 object-cover rounded"
              />
              <div
                v-else
                class="h-28 w-19 rounded bg-muted flex items-center justify-center"
              >
                <UIcon
                  name="i-lucide-book"
                  class="text-3xl text-muted"
                />
              </div>
            </div>
            <div class="min-w-0 flex-1">
              <UBadge
                color="warning"
                variant="subtle"
                class="mb-2"
              >
                Lent out
              </UBadge>
              <h3 class="font-semibold line-clamp-2 transition-colors group-hover:text-primary">
                {{ loan.book.title }}
              </h3>
              <p class="text-sm text-muted line-clamp-1">
                {{ loan.book.author }}
              </p>
              <p class="mt-2 text-sm text-muted">
                {{ borrowerLabel(loan) }} · Lent {{ formatDate(loan.loanedAt) }}
              </p>
              <p
                v-if="loan.dueAt"
                class="text-sm text-muted"
              >
                Due {{ formatDate(loan.dueAt) }}
              </p>
              <div
                class="mt-2"
                @click.stop
              >
                <UTextarea
                  v-if="editingLoanId === loan.id"
                  v-model="draftNote"
                  aria-label="Loan note"
                  data-testid="loan-note-field"
                  class="w-full"
                  autofocus
                  :maxlength="LOAN_NOTE_MAX_LENGTH"
                  @keydown.ctrl.enter.prevent.stop="saveNote(loan)"
                  @keydown.meta.enter.prevent.stop="saveNote(loan)"
                />
                <p
                  v-else-if="loan.note"
                  class="whitespace-pre-wrap text-sm text-muted"
                >
                  {{ loan.note }}
                </p>
              </div>
              <div
                class="mt-3 flex flex-wrap items-center gap-2"
                @click.stop
              >
                <template v-if="editingLoanId === loan.id">
                  <UButton
                    size="sm"
                    @click="saveNote(loan)"
                  >
                    Save note
                  </UButton>
                  <UButton
                    size="sm"
                    color="neutral"
                    variant="soft"
                    @click="cancelNoteEdit"
                  >
                    Cancel
                  </UButton>
                  <UButton
                    size="sm"
                    color="neutral"
                    variant="soft"
                    @click="clearNote"
                  >
                    Clear
                  </UButton>
                </template>
                <UButton
                  v-else
                  size="sm"
                  color="neutral"
                  variant="outline"
                  icon="i-lucide-pencil"
                  @click="editNote(loan)"
                >
                  {{ loan.note ? 'Edit note' : 'Add note' }}
                </UButton>
                <UFieldGroup>
                  <UButton
                    color="neutral"
                    variant="outline"
                    size="sm"
                    icon="i-lucide-undo-2"
                    :loading="returningLoanId === loan.id"
                    :disabled="Boolean(returningLoanId || cancellingLoanId)"
                    @click="emit('returnLoan', loan)"
                  >
                    Mark returned
                  </UButton>
                  <UDropdownMenu
                    v-if="!loan.acceptedAt"
                    :items="[{
                      label: 'Cancel loan',
                      icon: 'i-lucide-ban',
                      color: 'error',
                      onSelect: () => emit('cancelLoan', loan)
                    }]"
                  >
                    <UButton
                      color="neutral"
                      variant="outline"
                      size="sm"
                      icon="i-lucide-chevron-down"
                      aria-label="More loan actions"
                      :loading="cancellingLoanId === loan.id"
                      :disabled="Boolean(returningLoanId || cancellingLoanId)"
                    />
                  </UDropdownMenu>
                </UFieldGroup>
              </div>
            </div>
          </div>
        </UCard>
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        No books are currently loaned out.
      </p>
    </section>

    <section>
      <h2 class="text-lg font-semibold mb-3">
        History
      </h2>
      <div
        v-if="loanHistory.length > 0"
        class="space-y-3"
      >
        <UCard
          v-for="loan in loanHistory"
          :key="loan.id"
          variant="subtle"
          class="group cursor-pointer transition hover:ring-1 hover:ring-primary/30"
          role="link"
          tabindex="0"
          :aria-label="`Open ${loan.book.title}`"
          @click="openBook(loan)"
          @keydown.enter.self.prevent.stop="openBook(loan)"
          @keydown.space.self.prevent.stop="openBook(loan)"
        >
          <div class="flex items-center justify-between gap-4">
            <div class="flex min-w-0 items-center gap-3">
              <div class="shrink-0">
                <NuxtImg
                  v-if="coverUrl(loan)"
                  :src="coverUrl(loan)!"
                  :alt="loan.book.title"
                  class="h-18 w-12 rounded object-cover"
                />
                <div
                  v-else
                  class="h-18 w-12 rounded bg-muted flex items-center justify-center"
                >
                  <UIcon
                    name="i-lucide-book"
                    class="text-xl text-muted"
                  />
                </div>
              </div>
              <div class="min-w-0">
                <h3 class="font-semibold truncate transition-colors group-hover:text-primary">
                  {{ loan.book.title }}
                </h3>
                <p class="text-sm text-muted truncate">
                  {{ loan.book.author }} · {{ borrowerLabel(loan) }}
                </p>
                <p class="text-sm text-muted">
                  {{ loan.status === 'returned' ? returnedLabel(loan.returnedAt) : 'Canceled' }}
                </p>
                <p
                  v-if="loan.note"
                  class="whitespace-pre-wrap text-sm text-muted"
                >
                  {{ loan.note }}
                </p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <UBadge
                v-if="loan.status === 'canceled'"
                color="warning"
                variant="soft"
                size="md"
                class="min-h-7 px-2.5"
              >
                Canceled
              </UBadge>
              <UButton
                color="error"
                variant="subtle"
                size="sm"
                icon="i-lucide-trash-2"
                aria-label="Delete loan record"
                :loading="deletingLoanId === loan.id"
                :disabled="Boolean(deletingLoanId)"
                @click.stop="openDeleteLoanModal(loan)"
              >
                Delete
              </UButton>
            </div>
          </div>
        </UCard>
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        Returned books will stay here.
      </p>
    </section>
  </div>

  <UModal
    v-if="deleteLoanTarget"
    v-model:open="isDeleteLoanModalOpen"
    title="Delete loan record?"
    :description="deleteLoanDescription"
    :close="false"
    :ui="{ content: 'max-w-md', footer: 'justify-end gap-2 p-5' }"
  >
    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        :disabled="Boolean(deletingLoanId)"
        @click="cancelDeleteLoan"
      >
        Cancel
      </UButton>
      <UButton
        color="error"
        variant="subtle"
        icon="i-lucide-trash-2"
        :loading="deletingLoanId === deleteLoanTarget.id"
        :disabled="Boolean(deletingLoanId)"
        @click="confirmDeleteLoan"
      >
        Delete permanently
      </UButton>
    </template>
  </UModal>
</template>
