<script setup lang="ts">
/**
 * Reusable book preview component showing cover, details, and action buttons
 */
defineProps<{
  book: BookLookupResult
  isAdding?: boolean
  backLabel?: string
  backIcon?: string
}>()

defineEmits<{
  add: []
  back: []
}>()
</script>

<template>
  <div class="space-y-6">
    <div class="flex gap-6">
      <!-- Cover Preview -->
      <div class="w-32 max-h-48 flex-shrink-0 rounded-lg overflow-hidden shadow-md">
        <NuxtImg
          v-if="book.coverUrl"
          :src="book.coverUrl"
          :alt="book.title || 'Book cover'"
          class="max-w-full max-h-full object-cover"
          loading="eager"
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

      <!-- Book Details -->
      <div class="flex-1 space-y-3">
        <h2 class="text-xl font-semibold">
          {{ book.title }}
        </h2>
        <p class="text-muted">
          {{ book.author }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UBadge
            color="neutral"
            variant="subtle"
          >
            ISBN: {{ book.isbn }}
          </UBadge>
          <UBadge
            v-if="book.publishDate"
            color="neutral"
            variant="subtle"
          >
            {{ book.publishDate }}
          </UBadge>
          <UBadge
            v-if="book.numberOfPages"
            color="neutral"
            variant="subtle"
          >
            {{ book.numberOfPages }} pages
          </UBadge>
        </div>
        <p
          v-if="book.publishers && book.publishers.length > 0"
          class="text-sm text-muted"
        >
          Publisher: {{ book.publishers.join(', ') }}
        </p>
      </div>
    </div>

    <!-- Description preview -->
    <div
      v-if="book.description"
      class="text-sm text-muted line-clamp-3"
    >
      {{ book.description }}
    </div>

    <!-- Subjects preview -->
    <div
      v-if="book.subjects && book.subjects.length > 0"
      class="flex flex-wrap gap-2"
    >
      <UBadge
        v-for="subject in book.subjects.slice(0, 5)"
        :key="subject"
        size="md"
        color="secondary"
        variant="subtle"
      >
        {{ subject }}
      </UBadge>
      <span
        v-if="book.subjects.length > 5"
        class="text-sm text-muted self-center"
      >
        +{{ book.subjects.length - 5 }} more
      </span>
    </div>

    <USeparator />

    <!-- Adding state -->
    <div
      v-if="isAdding"
      class="text-center py-4"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="animate-spin text-2xl text-primary mb-2"
      />
      <p class="text-sm text-muted">
        Adding book and downloading cover image...
      </p>
    </div>

    <div
      v-else
      class="flex gap-3"
    >
      <UButton
        :icon="backIcon || 'i-lucide-arrow-left'"
        color="neutral"
        variant="outline"
        size="lg"
        @click="$emit('back')"
      >
        {{ backLabel || 'Back' }}
      </UButton>
      <UButton
        icon="i-lucide-plus"
        size="lg"
        class="flex-1"
        @click="$emit('add')"
      >
        Add to Library
      </UButton>
    </div>
  </div>
</template>
