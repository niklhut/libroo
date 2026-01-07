<script setup lang="ts">
interface Props {
  id: string
  bookId: string
  title: string
  author: string
  isbn?: string | null
  coverPath?: string | null
  addedAt?: string | Date
}

const props = defineProps<Props>()

const emit = defineEmits<{
  remove: [id: string]
}>()

// Computed cover URL
const coverUrl = computed(() => {
  if (props.coverPath) {
    return `/api/blob/${props.coverPath}`
  }
  return null
})

// Format date
const formattedDate = computed(() => {
  if (!props.addedAt) return null
  const date = props.addedAt instanceof Date ? props.addedAt : new Date(props.addedAt)
  return date.toLocaleDateString()
})
</script>

<template>
  <NuxtLink :to="`/library/${id}`" class="block group">
    <UCard class="overflow-hidden h-full transition-shadow hover:shadow-lg">
      <!-- Cover in header slot -->
      <template #header>
        <div class="aspect-[2/3] bg-muted flex items-center justify-center relative -m-4 mb-0">
          <img
            v-if="coverUrl"
            :src="coverUrl"
            :alt="title"
            class="w-full h-full object-cover"
          >
          <UIcon
            v-else
            name="i-lucide-book"
            class="text-4xl text-muted"
          />

          <!-- Hover overlay with remove button -->
          <div
            class="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
            @click.prevent.stop
          >
            <UButton
              color="error"
              variant="solid"
              icon="i-lucide-trash-2"
              size="sm"
              @click.prevent.stop="emit('remove', id)"
            >
              Remove
            </UButton>
          </div>
        </div>
      </template>

      <!-- Book Info -->
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
</template>
