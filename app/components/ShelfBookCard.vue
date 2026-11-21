<script setup lang="ts">
import type { LibraryState } from '~~/shared/types/book'

interface Props {
  id: string
  bookId: string
  libraryState?: LibraryState
  title: string
  author: string
  isbn?: string | null
  coverPath?: string | null
  location?: BookLocation | null
  lastKnownLocation?: string | null
  addedAt?: string | Date
  activeLoan?: ActiveLoanSummary | null
  tags?: string[]
  enrichmentStatus?: BookEnrichmentUiStatus | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'tag-selected': [tag: string] }>()
const visibleTags = computed(() => props.tags?.slice(0, 2) ?? [])
const hiddenTagCount = computed(() => Math.max(0, (props.tags?.length ?? 0) - visibleTags.value.length))
const enrichmentMessage = computed(() => {
  if (props.enrichmentStatus === 'no_cover') return 'Cover unavailable'
  if (props.enrichmentStatus === 'not_found') return 'Details not found'
  if (props.enrichmentStatus === 'failed') return 'Enrichment failed'
  return null
})

// Computed cover URL - blob images are already WebP, use directly
const coverUrl = computed(() => {
  if (props.coverPath) {
    return `/api/blob/${props.coverPath}`
  }
  return null
})
</script>

<template>
  <article
    data-testid="book-card"
    class="group flex h-full min-w-0 flex-col"
  >
    <NuxtLink
      :to="`/library/${id}`"
      prefetch-on="interaction"
      class="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
    >
      <div class="relative isolate aspect-2/3 overflow-hidden rounded-xl bg-elevated shadow-md ring-1 ring-black/10 transition duration-300 motion-safe:group-hover:-translate-y-1 motion-safe:group-hover:shadow-xl dark:ring-white/10">
        <NuxtImg
          v-if="coverUrl"
          :src="coverUrl"
          :alt="`Cover of ${title}`"
          width="300"
          height="450"
          class="absolute inset-0 size-full object-contain"
          loading="lazy"
        />
        <BookJacket
          v-else
          :title="title"
          :author="author"
        />
        <div
          class="pointer-events-none absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent"
          aria-hidden="true"
        />
        <div class="absolute top-2 right-2 left-2 flex flex-wrap gap-1">
          <UBadge
            v-if="activeLoan"
            color="warning"
            variant="solid"
            size="sm"
            class="rounded-md shadow-sm"
          >Lent out</UBadge>
          <UBadge
            v-else-if="libraryState === 'wishlisted'"
            color="info"
            variant="solid"
            size="sm"
            class="rounded-md shadow-sm"
          >Wishlist</UBadge>
          <UBadge
            v-else-if="libraryState === 'previously_owned'"
            color="neutral"
            variant="solid"
            size="sm"
            class="rounded-md shadow-sm"
          >Previously owned</UBadge>
        </div>
        <div
          data-testid="book-card-location"
          class="absolute right-3 bottom-3 left-3 flex min-w-0 items-center gap-1.5 text-xs font-medium text-white/95"
          :title="location?.path || lastKnownLocation || undefined"
        >
          <UIcon
            name="i-lucide-map-pin"
            class="size-3.5 shrink-0 text-white/65"
          />
          <span class="truncate">{{ location?.path || lastKnownLocation || 'No location' }}</span>
        </div>
      </div>
      <div class="pt-3">
        <h3
          class="min-h-10 text-sm leading-5 font-semibold text-highlighted line-clamp-2"
          :title="title"
        >{{ title }}</h3>
        <p
          class="mt-1 truncate text-xs text-muted"
          :title="author"
        >{{ author || 'Unknown author' }}</p>
      </div>
    </NuxtLink>
    <div
      class="mt-2 flex min-h-7 flex-wrap items-start gap-1"
      aria-label="Book tags"
    >
      <UButton
        v-for="tag in visibleTags"
        :key="tag"
        color="neutral"
        variant="soft"
        size="xs"
        class="max-w-full rounded-md px-1.5 py-0.5 text-[10px]"
        :title="`Filter by tag: ${tag}`"
        :aria-label="`Filter by tag: ${tag}`"
        :ui="{ label: 'truncate' }"
        @click="emit('tag-selected', tag)"
      >
        {{ tag }}
      </UButton>
      <UBadge
        v-if="hiddenTagCount"
        color="neutral"
        variant="subtle"
        size="sm"
        class="rounded-md text-[10px]"
      >
        +{{ hiddenTagCount }}
      </UBadge>
    </div>
    <p
      v-if="!coverUrl && (enrichmentStatus || enrichmentMessage)"
      class="mt-1 flex items-center gap-1 text-[10px] text-muted"
    >
      <UIcon
        v-if="enrichmentStatus === 'queued' || enrichmentStatus === 'preparing' || enrichmentStatus === 'retrying'"
        name="i-lucide-loader-2"
        class="size-3 animate-spin"
      />
      {{ enrichmentMessage || 'Finding book details' }}
    </p>
  </article>
</template>
