<script setup lang="ts">
import type { LibraryBook } from '~~/shared/types/book'

const props = defineProps<{ title: string, books: LibraryBook[], total: number, canLoad: boolean, hasMore?: boolean, loading?: boolean }>()
const emit = defineEmits<{ tag: [tag: string], loadMore: [] }>()
const carousel = useTemplateRef('carousel')
const shelf = useTemplateRef<HTMLElement>('shelf')
const isNearViewport = ref(false)
let initialRequested = false
const canGoBack = ref(false)
const canGoForward = ref(false)
let previousSnap = 0
let movingByArrow = false
let advanceAfterLoad = false

function requestNextRow() {
  if (!props.canLoad || !props.hasMore || props.loading || advanceAfterLoad) return
  advanceAfterLoad = props.books.length > 0
  emit('loadMore')
  void nextTick(() => {
    if (!props.loading) advanceAfterLoad = false
  })
}

function onSelect(index: number) {
  const api = carousel.value?.emblaApi
  canGoBack.value = api?.canScrollPrev() ?? false
  canGoForward.value = api?.canScrollNext() ?? false
  const movedForward = index > previousSnap
  previousSnap = index
  if (!movingByArrow && movedForward && !canGoForward.value) requestNextRow()
}

function goForward() {
  const api = carousel.value?.emblaApi
  if (!api?.canScrollNext()) {
    requestNextRow()
    return
  }
  movingByArrow = true
  api.scrollNext(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  movingByArrow = false
}

watch(shelf, (element, _, onCleanup) => {
  if (!element) return
  const observer = new IntersectionObserver(([entry]) => {
    isNearViewport.value = entry?.isIntersecting ?? false
  }, { rootMargin: '200px' })
  observer.observe(element)
  onCleanup(() => observer.disconnect())
}, { flush: 'post' })

watch(() => [isNearViewport.value, props.canLoad, props.books.length, props.hasMore] as const,
  ([near, canLoad, count, hasMore], [, , previousCount]) => {
    if (!near || !canLoad || (previousCount > 0 && count === 0)) initialRequested = false
    if (!near || !canLoad || count || !hasMore || props.loading || initialRequested) return
    initialRequested = true
    emit('loadMore')
  }
)

watch(() => [props.books.length, props.loading] as const, ([length, loading], [previousLength]) => {
  if (loading || !advanceAfterLoad) return
  advanceAfterLoad = false
  const api = carousel.value?.emblaApi
  if (!api || length <= previousLength) return
  // Rebuild snap points after Vue adds the new slides. Snap indices represent rows.
  movingByArrow = true
  api.reInit()
  api.scrollNext(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  movingByArrow = false
}, { flush: 'post' })
</script>

<template>
  <section
    ref="shelf"
    :aria-label="title"
    class="min-w-0 space-y-4"
  >
    <div class="flex min-h-8 items-center gap-3">
      <span
        class="h-5 w-1 rounded-full bg-primary"
        aria-hidden="true"
      />
      <h2 class="text-lg font-semibold tracking-tight text-highlighted sm:text-xl">
        {{ title }}
      </h2>
      <span class="shrink-0 text-xs text-muted">{{ books.length && hasMore ? `${books.length} loaded` : `${total} ${total === 1 ? 'book' : 'books'}` }}</span>
      <div class="ms-auto flex shrink-0 gap-2">
        <UButton
          icon="i-lucide-chevron-left"
          color="neutral"
          variant="outline"
          size="sm"
          class="rounded-full"
          aria-label="Previous books"
          :disabled="!canGoBack"
          @click="carousel?.emblaApi?.scrollPrev()"
        />
        <UButton
          icon="i-lucide-chevron-right"
          color="neutral"
          variant="outline"
          size="sm"
          class="rounded-full"
          aria-label="Next books"
          :loading="loading"
          :disabled="!canLoad || (!canGoForward && !hasMore)"
          @click="goForward"
        />
      </div>
    </div>
    <UCarousel
      v-if="books.length"
      ref="carousel"
      v-slot="{ item }"
      :items="books"
      align="start"
      slides-to-scroll="auto"
      :aria-label="`${title} books`"
      :ui="{
        root: 'relative',
        viewport: 'overflow-hidden pt-1 pb-2',
        container: '-ms-4',
        item: 'basis-1/2 ps-4 sm:basis-1/3 md:basis-1/4 lg:basis-1/6'
      }"
      wheel-gestures
      @select="onSelect"
    >
      <ShelfBookCard
        :id="item.id"
        :book-id="item.bookId"
        :title="item.title"
        :author="item.author"
        :isbn="item.isbn"
        :cover-path="item.coverPath"
        :location="item.location"
        :last-known-location="item.lastKnownLocation"
        :added-at="item.addedAt"
        :active-loan="item.activeLoan"
        :library-state="item.libraryState"
        :tags="item.tags"
        :enrichment-status="item.enrichmentStatus"
        @tag-selected="emit('tag', $event)"
      />
    </UCarousel>
    <div
      v-else
      class="grid grid-cols-2 gap-4 pt-1 pb-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
      aria-hidden="true"
      data-testid="shelf-placeholder"
    >
      <div
        v-for="slot in 6"
        :key="slot"
        class="min-w-0"
        :class="{ 'hidden sm:block': slot === 3, 'hidden md:block': slot === 4, 'hidden lg:block': slot > 4 }"
      >
        <USkeleton class="aspect-2/3 rounded-xl" />
        <div class="h-25" />
      </div>
    </div>
  </section>
</template>
