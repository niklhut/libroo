<script setup lang="ts">
const props = defineProps<{
  rating: number | null
}>()

const emit = defineEmits<{
  'update:rating': [rating: number | null]
}>()

const hoveredStar = ref(0)

function selectRating(star: number) {
  // Click same star to clear rating
  if (props.rating === star) {
    emit('update:rating', null)
  } else {
    emit('update:rating', star)
  }
}

function isStarFilled(star: number): boolean {
  if (hoveredStar.value > 0) {
    return star <= hoveredStar.value
  }
  return props.rating !== null && star <= (props.rating ?? 0)
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between gap-3 mb-2">
      <h2 class="text-lg font-semibold">
        Rating
      </h2>
      <span
        v-if="rating"
        class="text-sm text-muted"
      >
        {{ rating }} / 5
      </span>
    </div>
    <div
      class="flex items-center gap-1"
      @mouseleave="hoveredStar = 0"
    >
      <button
        v-for="star in 5"
        :key="star"
        type="button"
        class="p-0.5 rounded-md transition-all duration-150 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        :aria-label="`Rate ${star} star${star > 1 ? 's' : ''}`"
        @click="selectRating(star)"
        @mouseenter="hoveredStar = star"
      >
        <UIcon
          name="i-lucide-star"
          class="text-2xl transition-colors duration-150"
          :class="isStarFilled(star) ? 'text-amber-400' : 'text-neutral-300 dark:text-neutral-600'"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
button:hover .text-neutral-300,
button:hover .text-neutral-600 {
  color: var(--color-amber-200);
}
</style>
