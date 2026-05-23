<script setup lang="ts">
import type { OwnerLoan } from '~~/shared/types/book'

const props = defineProps<{
  loans: OwnerLoan[]
  returningLoanId: string | null
}>()

const emit = defineEmits<{
  returnLoan: [loan: OwnerLoan]
}>()

const activeLoans = computed(() => props.loans.filter(loan => loan.status === 'active'))
const loanHistory = computed(() => props.loans.filter(loan => loan.status !== 'active'))

function coverUrl(loan: OwnerLoan) {
  return loan.book.coverPath ? `/api/blob/${loan.book.coverPath}` : null
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

function returnedLabel(value: Date | string | null): string {
  const formatted = formatDate(value)
  return formatted ? `Returned ${formatted}` : 'Returned'
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
              <UButton
                class="mt-3"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-undo-2"
                :loading="returningLoanId === loan.id"
                :disabled="Boolean(returningLoanId)"
                @click.stop="emit('returnLoan', loan)"
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
