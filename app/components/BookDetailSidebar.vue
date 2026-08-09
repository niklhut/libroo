<script setup lang="ts">
const props = defineProps<{
  book: BookDetails
}>()

const coverUrl = computed(() => props.book.coverPath ? `/api/blob/${props.book.coverPath}` : null)
const isOwnedBook = computed(() => props.book.libraryState === 'owned')
const readingSummary = computed(() => {
  const progress = props.book.readingProgress
  if (!progress) return ''
  if (progress.status === 'read') return 'Read · Finished'
  if (progress.status === 'reading') {
    return progress.currentPage !== null && props.book.numberOfPages
      ? `Reading · ${progress.currentPage} of ${props.book.numberOfPages} pages`
      : `Reading · ${progress.progressPercent ?? 0}% complete`
  }
  return 'Unread · Not started'
})
</script>

<template>
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

      <UCard
        class="sm:col-start-2 sm:row-start-1 lg:col-auto"
        :ui="{ body: 'p-4' }"
        aria-labelledby="summary-heading"
      >
        <h2
          id="summary-heading"
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
            </dt>
            <dd class="text-right font-medium">
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
            </dt>
            <dd class="max-w-36 text-right font-medium">
              {{ book.location?.path || 'Not set' }}
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
            </dt>
            <dd class="max-w-36 text-right font-medium">
              {{ readingSummary }}
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
            </dt>
            <dd class="flex min-h-5 items-center justify-end gap-0.5">
              <template v-if="book.rating">
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
              >Not rated</span>
            </dd>
          </div>
        </dl>
      </UCard>
    </div>
  </aside>
</template>
