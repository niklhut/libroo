<script setup lang="ts">
import type { BorrowedBook, OwnerLoan } from '~~/shared/types/book'

type LoansView = 'loaned' | 'borrowed'

usePageTitle('Loans')

const toast = useToast()
const route = useRoute()
const router = useRouter()
const initialView = route.query.view === 'borrowed' ? 'borrowed' : 'loaned'
const view = ref<LoansView>(initialView)
const returningLoanId = ref<string | null>(null)

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

async function returnLoan(loan: OwnerLoan) {
  if (returningLoanId.value) return

  returningLoanId.value = loan.id
  try {
    await $fetch(`/api/loans/${loan.id}/return`, {
      method: 'POST'
    })
    await refreshOwnerLoans()
    toast.add({
      title: 'Book marked as returned',
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'Unable to mark returned')
    toast.add({
      title: 'Could not update loan',
      description: message,
      color: 'error'
    })
  } finally {
    returningLoanId.value = null
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
        @return-loan="returnLoan"
      />

      <BorrowedLoansSection
        v-else
        :books="borrowedBooks"
      />
    </UPageBody>
  </UContainer>
</template>
