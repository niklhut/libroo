<script setup lang="ts">
import { useId } from 'vue'

const props = defineProps<{
  description: string
}>()

const likelyTruncated = computed(() => {
  const explicitLines = props.description.split('\n').length

  return explicitLines > 4 || props.description.length > 260
})

const measureParagraph = ref<HTMLElement | null>(null)
const expanded = ref(false)
const isTruncated = ref(likelyTruncated.value)
const isClamped = ref(true)
const collapsedHeight = ref<number | null>(null)
const fullHeight = ref<number | null>(null)
const descriptionId = useId()

let resizeObserver: ResizeObserver | null = null
let animationFrame: number | null = null
let clampTimeout: ReturnType<typeof setTimeout> | null = null

function checkTruncation() {
  const element = measureParagraph.value
  if (!element) return

  collapsedHeight.value = element.clientHeight
  fullHeight.value = element.scrollHeight

  isTruncated.value = element.scrollHeight > element.clientHeight + 1
}

function scheduleTruncationCheck() {
  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
  }

  animationFrame = requestAnimationFrame(() => {
    animationFrame = null
    checkTruncation()
  })
}

onMounted(async () => {
  await nextTick()
  checkTruncation()

  if (measureParagraph.value) {
    resizeObserver = new ResizeObserver(scheduleTruncationCheck)
    resizeObserver.observe(measureParagraph.value)
  }
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()

  if (animationFrame !== null) {
    cancelAnimationFrame(animationFrame)
  }

  if (clampTimeout !== null) {
    clearTimeout(clampTimeout)
  }
})

watch(() => props.description, async () => {
  expanded.value = false
  isClamped.value = true
  isTruncated.value = likelyTruncated.value
  await nextTick()
  checkTruncation()
})

const paragraphStyle = computed(() => {
  const height = expanded.value ? fullHeight.value : collapsedHeight.value

  return height === null
    ? undefined
    : { maxHeight: `${height}px` }
})

function toggleExpanded() {
  if (clampTimeout !== null) {
    clearTimeout(clampTimeout)
    clampTimeout = null
  }

  if (expanded.value) {
    isClamped.value = false
    expanded.value = false
    clampTimeout = setTimeout(() => {
      if (!expanded.value) {
        isClamped.value = true
      }
    }, 250)
    return
  }

  isClamped.value = false
  expanded.value = true
}

function onParagraphTransitionEnd(event: TransitionEvent) {
  if (event.propertyName !== 'max-height' || expanded.value) return

  if (clampTimeout !== null) {
    clearTimeout(clampTimeout)
    clampTimeout = null
  }

  isClamped.value = true
}
</script>

<template>
  <div class="relative space-y-1">
    <p
      ref="measureParagraph"
      class="invisible pointer-events-none absolute inset-x-0 top-0 text-muted leading-relaxed whitespace-pre-wrap line-clamp-4"
      aria-hidden="true"
    >
      {{ description }}
    </p>

    <p
      :id="descriptionId"
      class="overflow-hidden text-muted leading-relaxed whitespace-pre-wrap transition-[max-height] duration-200 ease-out"
      :class="{ 'line-clamp-4': isClamped }"
      :style="paragraphStyle"
      @transitionend="onParagraphTransitionEnd"
    >
      {{ description }}
    </p>

    <UButton
      v-if="isTruncated"
      color="neutral"
      variant="link"
      size="sm"
      class="-ms-1 px-1.5 text-muted hover:text-highlighted"
      :trailing-icon="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
      :aria-expanded="expanded"
      :aria-controls="descriptionId"
      :aria-label="expanded ? 'Show less of the book description' : 'Show more of the book description'"
      @click="toggleExpanded"
    >
      {{ expanded ? 'Show less' : 'Show more' }}
    </UButton>
  </div>
</template>
