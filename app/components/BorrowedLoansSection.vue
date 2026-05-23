<script setup lang="ts">
import type { BorrowedBook } from '~~/shared/types/book'

const props = defineProps<{
  books: BorrowedBook[]
}>()

const activeBooks = computed(() => props.books.filter(book => book.status === 'active'))
const bookHistory = computed(() => props.books.filter(book => book.status !== 'active'))

function coverUrl(book: BorrowedBook) {
  return book.coverPath ? `/api/blob/${book.coverPath}` : null
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
</script>

<template>
  <UCard
    v-if="books.length === 0"
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
        v-if="activeBooks.length > 0"
        class="grid gap-4 md:grid-cols-2"
      >
        <UCard
          v-for="book in activeBooks"
          :key="book.id"
          variant="subtle"
        >
          <div class="flex gap-4">
            <NuxtImg
              v-if="coverUrl(book)"
              :src="coverUrl(book)!"
              :alt="book.title"
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
                {{ book.title }}
              </h3>
              <p class="text-sm text-muted line-clamp-1">
                {{ book.author }}
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
        v-if="bookHistory.length > 0"
        class="space-y-3"
      >
        <UCard
          v-for="book in bookHistory"
          :key="book.id"
          variant="subtle"
        >
          <div class="flex items-center justify-between gap-4">
            <div class="flex min-w-0 items-center gap-3">
              <NuxtImg
                v-if="coverUrl(book)"
                :src="coverUrl(book)!"
                :alt="book.title"
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
                  {{ book.title }}
                </h3>
                <p class="text-sm text-muted truncate">
                  {{ book.author }} · Lent by {{ book.ownerName }}
                </p>
                <p class="text-sm text-muted">
                  {{ book.status === 'returned' ? returnedLabel(book.returnedAt) : 'No longer active' }}
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
