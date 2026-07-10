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
}

const props = defineProps<Props>()

// Computed cover URL - blob images are already WebP, use directly
const coverUrl = computed(() => {
  if (props.coverPath) {
    return `/api/blob/${props.coverPath}`
  }
  return null
})
</script>

<template>
  <NuxtLink
    :to="`/library/${id}`"
    class="block cursor-pointer"
  >
    <UCard
      variant="subtle"
      class="h-full transition-all hover:shadow-lg dark:hover:shadow-neutral-700"
      :ui="{
        header: 'p-0 sm:px-0',
        body: 'p-2 sm:p-4'
      }"
    >
      <template #header>
        <div class="flex items-center justify-center relative">
          <NuxtImg
            v-if="coverUrl"
            :src="coverUrl"
            :alt="title"
            class="w-full object-cover"
            loading="lazy"
          />
          <div
            v-else
            class="w-full h-full flex items-center justify-center bg-muted aspect-[1/1.5]"
          >
            <UIcon
              name="i-lucide-book"
              class="text-4xl text-muted"
            />
          </div>
          <UBadge
            v-if="activeLoan"
            color="warning"
            variant="solid"
            size="sm"
            class="absolute top-2 left-2"
          >
            Lent out
          </UBadge>
          <UBadge
            v-if="libraryState === 'wishlisted'"
            color="info"
            variant="solid"
            size="sm"
            class="absolute top-2 right-2"
          >
            Wishlist
          </UBadge>
          <UBadge
            v-if="libraryState === 'previously_owned'"
            color="neutral"
            variant="subtle"
            size="sm"
            class="absolute top-2 right-2"
          >
            Previously owned
          </UBadge>
        </div>
      </template>

      <div class="space-y-1">
        <h3 class="font-semibold text-sm line-clamp-2">
          {{ title }}
        </h3>
        <p class="text-xs text-muted line-clamp-1">
          {{ author }}
        </p>
        <div
          v-if="location || lastKnownLocation"
          class="flex items-center gap-1 text-xs text-muted"
        >
          <UIcon
            name="i-lucide-map-pin"
            class="size-3 shrink-0"
          />
          <span class="line-clamp-1">{{ location?.path || `Last known: ${lastKnownLocation}` }}</span>
        </div>
      </div>
    </UCard>
  </NuxtLink>
</template>
