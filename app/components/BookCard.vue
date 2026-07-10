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
}

const props = defineProps<Props>()
const emit = defineEmits<{ 'tag-selected': [tag: string] }>()
const visibleTags = computed(() => props.tags?.slice(0, 3) ?? [])
const hiddenTagCount = computed(() => Math.max(0, (props.tags?.length ?? 0) - visibleTags.value.length))

function selectTag(event: MouseEvent, tag: string) {
  event.preventDefault()
  event.stopPropagation()
  emit('tag-selected', tag)
}

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
          v-if="visibleTags.length"
          class="flex flex-wrap gap-1 pt-1"
        >
          <UBadge
            v-for="tag in visibleTags"
            :key="tag"
            color="primary"
            variant="soft"
            size="sm"
            class="cursor-pointer"
            @click="selectTag($event, tag)"
          >
            {{ tag }}
          </UBadge>
          <UBadge
            v-if="hiddenTagCount"
            color="neutral"
            variant="soft"
            size="sm"
          >
            +{{ hiddenTagCount }}
          </UBadge>
        </div>
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
