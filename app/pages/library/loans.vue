<script setup lang="ts">
import type { BorrowedBook, OwnerLoan } from '~~/shared/types/book'

type LoansView = 'loaned' | 'borrowed'

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

const activeOwnerLoans = computed(() => ownerLoans.value.filter(loan => loan.status === 'active'))
const ownerLoanHistory = computed(() => ownerLoans.value.filter(loan => loan.status !== 'active'))
const activeBorrowedBooks = computed(() => borrowedBooks.value.filter(book => book.status === 'active'))
const borrowedHistory = computed(() => borrowedBooks.value.filter(book => book.status !== 'active'))
const isPending = computed(() => view.value === 'loaned' ? ownerStatus.value === 'pending' : borrowedStatus.value === 'pending')

function loanCoverPath(item: OwnerLoan | BorrowedBook): string | null {
  return 'book' in item ? item.book.coverPath : item.coverPath
}

function loanTitle(item: OwnerLoan | BorrowedBook): string {
  return 'book' in item ? item.book.title : item.title
}

function loanAuthor(item: OwnerLoan | BorrowedBook): string {
  return 'book' in item ? item.book.author : item.author
}

function coverUrl(item: OwnerLoan | BorrowedBook) {
  const coverPath = loanCoverPath(item)
  return coverPath ? `/api/blob/${coverPath}` : null
}

function formatDate(value: Date | string | null): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function borrowerLabel(loan: OwnerLoan) {
  if (!loan.acceptedByName || loan.acceptedByName === loan.borrowerDisplayName) {
    return loan.borrowerDisplayName
  }
  return `${loan.acceptedByName} · entered as ${loan.borrowerDisplayName}`
}

function openOwnerBook(loan: OwnerLoan) {
  return navigateTo(`/library/${loan.userBookId}`)
}

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

      <template v-else-if="view === 'loaned'">
        <UCard
          v-if="ownerLoans.length === 0"
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
              v-if="activeOwnerLoans.length > 0"
              class="grid gap-4 md:grid-cols-2"
            >
              <UCard
                v-for="loan in activeOwnerLoans"
                :key="loan.id"
                variant="subtle"
                class="group cursor-pointer transition hover:ring-1 hover:ring-primary/30"
                role="link"
                tabindex="0"
                :aria-label="`Open ${loanTitle(loan)}`"
                @click="openOwnerBook(loan)"
                @keydown.enter.self.prevent.stop="openOwnerBook(loan)"
                @keydown.space.self.prevent.stop="openOwnerBook(loan)"
              >
                <div class="flex gap-4">
                  <div class="shrink-0">
                    <NuxtImg
                      v-if="coverUrl(loan)"
                      :src="coverUrl(loan)!"
                      :alt="loanTitle(loan)"
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
                      {{ loanTitle(loan) }}
                    </h3>
                    <p class="text-sm text-muted line-clamp-1">
                      {{ loanAuthor(loan) }}
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
                    <UButton
                      class="mt-3"
                      color="neutral"
                      variant="outline"
                      size="sm"
                      icon="i-lucide-undo-2"
                      :loading="returningLoanId === loan.id"
                      :disabled="Boolean(returningLoanId)"
                      @click.stop="returnLoan(loan)"
                    >
                      Mark returned
                    </UButton>
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
              v-if="ownerLoanHistory.length > 0"
              class="space-y-3"
            >
              <UCard
                v-for="loan in ownerLoanHistory"
                :key="loan.id"
                variant="subtle"
                class="group cursor-pointer transition hover:ring-1 hover:ring-primary/30"
                role="link"
                tabindex="0"
                :aria-label="`Open ${loanTitle(loan)}`"
                @click="openOwnerBook(loan)"
                @keydown.enter.self.prevent.stop="openOwnerBook(loan)"
                @keydown.space.self.prevent.stop="openOwnerBook(loan)"
              >
                <div class="flex items-center justify-between gap-4">
                  <div class="flex min-w-0 items-center gap-3">
                    <div class="shrink-0">
                      <NuxtImg
                        v-if="coverUrl(loan)"
                        :src="coverUrl(loan)!"
                        :alt="loanTitle(loan)"
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
                        {{ loanTitle(loan) }}
                      </h3>
                      <p class="text-sm text-muted truncate">
                        {{ loanAuthor(loan) }} · {{ borrowerLabel(loan) }}
                      </p>
                      <p class="text-sm text-muted">
                        {{ loan.status === 'returned' ? `Returned ${formatDate(loan.returnedAt)}` : 'Canceled' }}
                      </p>
                    </div>
                  </div>
                  <UBadge
                    :color="loan.status === 'returned' ? 'neutral' : 'warning'"
                    variant="subtle"
                  >
                    {{ loan.status === 'returned' ? 'Returned' : 'Canceled' }}
                  </UBadge>
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
      </template>

      <template v-else>
        <UCard
          v-if="borrowedBooks.length === 0"
          class="text-center py-12"
        >
          <UIcon
            name="i-lucide-book-user"
            class="text-6xl text-muted mx-auto mb-4"
          />
          <h2 class="text-xl font-semibold mb-2">
            No borrowed books yet
          </h2>
          <p class="text-muted">
            Accepted books will appear here.
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
              v-if="activeBorrowedBooks.length > 0"
              class="grid gap-4 md:grid-cols-2"
            >
              <UCard
                v-for="book in activeBorrowedBooks"
                :key="book.id"
                variant="subtle"
              >
                <div class="flex gap-4">
                  <NuxtImg
                    v-if="coverUrl(book)"
                    :src="coverUrl(book)!"
                    :alt="loanTitle(book)"
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
                  <div class="min-w-0 flex-1">
                    <UBadge
                      color="success"
                      variant="subtle"
                      class="mb-2"
                    >
                      With you
                    </UBadge>
                    <h3 class="font-semibold line-clamp-2">
                      {{ loanTitle(book) }}
                    </h3>
                    <p class="text-sm text-muted line-clamp-1">
                      {{ loanAuthor(book) }}
                    </p>
                    <p class="mt-2 text-sm text-muted">
                      Lent by {{ book.ownerName }} · {{ formatDate(book.loanedAt) }}
                    </p>
                    <p
                      v-if="book.dueAt"
                      class="text-sm text-muted"
                    >
                      Due {{ formatDate(book.dueAt) }}
                    </p>
                  </div>
                </div>
              </UCard>
            </div>
            <p
              v-else
              class="text-sm text-muted"
            >
              Nothing currently with you.
            </p>
          </section>

          <section>
            <h2 class="text-lg font-semibold mb-3">
              History
            </h2>
            <div
              v-if="borrowedHistory.length > 0"
              class="space-y-3"
            >
              <UCard
                v-for="book in borrowedHistory"
                :key="book.id"
                variant="subtle"
              >
                <div class="flex items-center justify-between gap-4">
                  <div class="flex min-w-0 items-center gap-3">
                    <NuxtImg
                      v-if="coverUrl(book)"
                      :src="coverUrl(book)!"
                      :alt="loanTitle(book)"
                      class="h-18 w-12 shrink-0 rounded object-cover"
                    />
                    <div
                      v-else
                      class="h-18 w-12 shrink-0 rounded bg-muted flex items-center justify-center"
                    >
                      <UIcon
                        name="i-lucide-book"
                        class="text-xl text-muted"
                      />
                    </div>
                    <div class="min-w-0">
                      <h3 class="font-semibold truncate">
                        {{ loanTitle(book) }}
                      </h3>
                      <p class="text-sm text-muted truncate">
                        {{ loanAuthor(book) }} · Lent by {{ book.ownerName }}
                      </p>
                      <p class="text-sm text-muted">
                        {{ book.status === 'returned' ? `Returned ${formatDate(book.returnedAt)}` : 'No longer active' }}
                      </p>
                    </div>
                  </div>
                  <UBadge
                    :color="book.status === 'returned' ? 'neutral' : 'warning'"
                    variant="subtle"
                  >
                    {{ book.status === 'returned' ? 'Returned' : 'Closed' }}
                  </UBadge>
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
      </template>
    </UPageBody>
  </UContainer>
</template>
