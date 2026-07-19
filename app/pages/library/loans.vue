<script setup lang="ts">
import type { BorrowedBook, OwnerLoan } from '~~/shared/types/book'
import type { Ref } from 'vue'

type LoansView = 'loaned' | 'borrowed'

usePageTitle('Loans')

const toast = useToast()
const route = useRoute()
const router = useRouter()
const initialView = route.query.view === 'borrowed' ? 'borrowed' : 'loaned'
const view = ref<LoansView>(initialView)
const returningLoanId = ref<string | null>(null)
const cancellingLoanId = ref<string | null>(null)
const deletingLoanId = ref<string | null>(null)
const loanNoteRequestIds = new Map<string, number>()

watch(
  () => route.query.view,
  (queryView) => {
    const nextView = queryView === 'borrowed' ? 'borrowed' : 'loaned'
    if (view.value !== nextView) {
      view.value = nextView
    }
  }
)

async function setView(nextView: LoansView) {
  if (view.value === nextView) return
  view.value = nextView
  await router.replace({
    query: {
      ...route.query,
      view: nextView
    }
  })
}

const { data: ownerLoans, status: ownerStatus, refresh: refreshOwnerLoans } = await useFetch<OwnerLoan[]>('/api/loans', {
  headers: useRequestHeaders(['cookie']),
  default: () => []
})

const { data: borrowedBooks, status: borrowedStatus } = await useFetch<BorrowedBook[]>('/api/borrowed', {
  headers: useRequestHeaders(['cookie']),
  default: () => []
})

const isPending = computed(() => view.value === 'loaned' ? ownerStatus.value === 'pending' : borrowedStatus.value === 'pending')

interface LoanActionOptions {
  endpoint: string
  requestOptions: { method: 'POST' | 'DELETE' }
  successTitle: string
  failureTitle: string
  fallbackErrorMessage: string
}

async function runLoanAction(loan: OwnerLoan, inFlightLoanId: Ref<string | null>, options: LoanActionOptions) {
  if (inFlightLoanId.value) return

  inFlightLoanId.value = loan.id
  try {
    await $fetch(options.endpoint, options.requestOptions)
    await refreshOwnerLoans()
    toast.add({
      title: options.successTitle,
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : options.fallbackErrorMessage)
    toast.add({
      title: options.failureTitle,
      description: message,
      color: 'error'
    })
  } finally {
    inFlightLoanId.value = null
  }
}

async function returnLoan(loan: OwnerLoan) {
  await runLoanAction(loan, returningLoanId, {
    endpoint: `/api/loans/${loan.id}/return`,
    requestOptions: { method: 'POST' },
    successTitle: 'Book marked as returned',
    failureTitle: 'Could not update loan',
    fallbackErrorMessage: 'Unable to mark returned'
  })
}

async function cancelLoan(loan: OwnerLoan) {
  await runLoanAction(loan, cancellingLoanId, {
    endpoint: `/api/loans/${loan.id}/cancel`,
    requestOptions: { method: 'POST' },
    successTitle: 'Loan canceled',
    failureTitle: 'Could not cancel loan',
    fallbackErrorMessage: 'Unable to cancel loan'
  })
}

async function deleteLoan(loan: OwnerLoan) {
  await runLoanAction(loan, deletingLoanId, {
    endpoint: `/api/loans/${loan.id}`,
    requestOptions: { method: 'DELETE' },
    successTitle: 'Loan record deleted',
    failureTitle: 'Could not delete loan record',
    fallbackErrorMessage: 'Unable to delete loan record'
  })
}

async function saveLoanNote(loan: OwnerLoan, note: string | null) {
  const currentRequestId = (loanNoteRequestIds.get(loan.id) ?? 0) + 1
  loanNoteRequestIds.set(loan.id, currentRequestId)
  const previousNote = loan.note
  loan.note = note
  try {
    await $fetch(`/api/loans/${loan.id}/note`, { method: 'PUT', body: { note } })
    if (currentRequestId === loanNoteRequestIds.get(loan.id)) {
      toast.add({ title: note ? 'Loan note saved' : 'Loan note removed', color: 'success' })
    }
  } catch (err: unknown) {
    if (currentRequestId === loanNoteRequestIds.get(loan.id)) loan.note = previousNote
    const message = (err as { data?: { message?: string } })?.data?.message ?? 'Unable to save loan note'
    toast.add({ title: 'Could not save loan note', description: message, color: 'error' })
  }
}
</script>

<template>
  <UContainer>
    <UPageHeader
      title="Loans"
      description="Track books you loaned out and books lent to you."
    >
      <template #links>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-library"
          to="/library"
        >
          My Library
        </UButton>
      </template>
    </UPageHeader>

    <UPageBody>
      <div class="mb-6">
        <UFieldGroup>
          <UButton
            :color="view === 'loaned' ? 'primary' : 'neutral'"
            :variant="view === 'loaned' ? 'solid' : 'outline'"
            icon="i-lucide-handshake"
            @click="setView('loaned')"
          >
            Loaned out
          </UButton>
          <UButton
            :color="view === 'borrowed' ? 'primary' : 'neutral'"
            :variant="view === 'borrowed' ? 'solid' : 'outline'"
            icon="i-lucide-book-user"
            @click="setView('borrowed')"
          >
            Lent to you
          </UButton>
        </UFieldGroup>
      </div>

      <div
        v-if="isPending"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <LoanedOutLoansSection
        v-else-if="view === 'loaned'"
        :loans="ownerLoans"
        :returning-loan-id="returningLoanId"
        :cancelling-loan-id="cancellingLoanId"
        :deleting-loan-id="deletingLoanId"
        @return-loan="returnLoan"
        @cancel-loan="cancelLoan"
        @delete-loan="deleteLoan"
        @save-loan-note="saveLoanNote"
      />

      <BorrowedLoansSection
        v-else
        :books="borrowedBooks"
      />
    </UPageBody>
  </UContainer>
</template>
