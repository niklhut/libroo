<script setup lang="ts">
const props = defineProps<{
  progress: ReadingProgress
  totalPages: number | null
}>()

const emit = defineEmits<{
  edit: []
}>()

const displayedPercent = computed(() => {
  if (props.progress.currentPage !== null && props.totalPages && props.totalPages > 0) {
    return Math.min(100, Math.round((props.progress.currentPage / props.totalPages) * 100))
  }

  return props.progress.progressPercent ?? 0
})

const statusLabel = computed(() => {
  if (props.progress.status === 'read') return 'Read'
  if (props.progress.status === 'reading') return 'Reading'
  return 'Unread'
})

const progressLabel = computed(() => {
  if (props.progress.status === 'read') return 'Finished'
  if (props.progress.currentPage !== null && props.totalPages) {
    return `${props.progress.currentPage} of ${props.totalPages} pages`
  }
  if (props.progress.progressPercent !== null) return `${props.progress.progressPercent}% done`
  return 'Not started'
})

const startedLabel = computed(() => formatDate(props.progress.startedAt))
const finishedLabel = computed(() => formatDate(props.progress.finishedAt))

function formatDate(value: Date | string | null): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">
          Reading Progress
        </h2>
        <p class="text-sm text-muted">
          {{ statusLabel }} · {{ progressLabel }}
        </p>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-pencil"
        @click="emit('edit')"
      >
        Update
      </UButton>
    </div>

    <UProgress
      :model-value="displayedPercent"
      :max="100"
      color="primary"
    />

    <div
      v-if="startedLabel || finishedLabel"
      class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted"
    >
      <span v-if="startedLabel">Started {{ startedLabel }}</span>
      <span v-if="finishedLabel">Finished {{ finishedLabel }}</span>
    </div>
  </div>
</template>
