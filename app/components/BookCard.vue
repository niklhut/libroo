<script setup lang="ts">
interface Props {
  id: string
  bookId: string
  title: string
  author: string
  isbn?: string | null
  coverPath?: string | null
  addedAt?: string | Date
  selected?: boolean
  selectable?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  selected: false,
  selectable: false
})

const emit = defineEmits<{
  select: [id: string]
}>()

// Computed cover URL - blob images are already WebP, use directly
const coverUrl = computed(() => {
  if (props.coverPath) {
    return `/api/blob/${props.coverPath}`
  }
  return null
})

// Handle click - either select or navigate
function handleClick(e: MouseEvent) {
  if (props.selectable) {
    e.preventDefault()
    emit('select', props.id)
  }
}
</script>

<template>
  <NuxtLink
    v-if="!selectable"
    :to="`/library/${id}`"
    class="block cursor-pointer"
  >
    <UCard
      variant="subtle"
      class="h-full transition-all hover:shadow-lg dark:hover:shadow-neutral-200/20"
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
        </div>
      </template>

      <div class="space-y-1">
        <h3 class="font-semibold text-sm line-clamp-2">
          {{ title }}
        </h3>
        <p class="text-xs text-muted line-clamp-1">
          {{ author }}
        </p>
      </div>
    </UCard>
  </NuxtLink>

  <!-- Selectable mode -->
  <div
    v-else
    class="block cursor-pointer"
    @click="handleClick"
  >
    <UCard
      class="overflow-hidden h-full transition-all"
      :class="{
        'ring-2 ring-primary shadow-lg': selected,
        'hover:shadow-lg': !selected
      }"
    >
      <!-- Cover in header slot - no padding -->
      <template #header>
        <div class="aspect-[2/3] bg-muted flex items-center justify-center relative -m-4 -mb-4">
          <!-- Use img directly for blob URLs (already WebP optimized) -->
          <img
            v-if="coverUrl"
            :src="coverUrl"
            :alt="title"
            class="w-full h-full object-cover"
            loading="lazy"
          >
          <UIcon
            v-else
            name="i-lucide-book"
            class="text-4xl text-muted"
          />

          <!-- Selection indicator -->
          <div class="absolute top-2 right-2">
            <div
              class="w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors"
              :class="selected
                ? 'bg-primary border-primary text-white'
                : 'bg-white/80 border-neutral-300'"
            >
              <UIcon
                v-if="selected"
                name="i-lucide-check"
                class="text-sm"
              />
            </div>
          </div>
        </div>
      </template>

      <!-- Book Info -->
      <div class="space-y-1 pt-2">
        <h3 class="font-semibold text-sm line-clamp-2">
          {{ title }}
        </h3>
        <p class="text-xs text-muted line-clamp-1">
          {{ author }}
        </p>
      </div>
    </UCard>
  </div>
</template>
