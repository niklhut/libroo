<script setup lang="ts">
type ProgressMode = 'pages' | 'percent'

interface ReadingProgressUpdate {
  status: ReadingStatus
  currentPage: number | null
  progressPercent: number | null
  startedAt: string | null
  finishedAt: string | null
}

const props = defineProps<{
  open: boolean
  progress: ReadingProgress
  totalPages: number | null
  saving?: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'save:progress': [progress: ReadingProgressUpdate]
}>()

const status = ref<ReadingStatus>('unread')
const progressMode = ref<ProgressMode>('percent')
const currentPage = ref('')
const progressPercent = ref('')
const startedAt = ref('')
const finishedAt = ref('')

const modalOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const statusItems: Array<{ value: ReadingStatus, label: string, icon: string }> = [
  { value: 'unread', label: 'Unread', icon: 'i-lucide-book-open' },
  { value: 'reading', label: 'Reading', icon: 'i-lucide-book-marked' },
  { value: 'read', label: 'Read', icon: 'i-lucide-check-circle-2' }
]

function initializeState() {
  status.value = props.progress.status
  progressMode.value = props.progress.currentPage !== null && props.totalPages ? 'pages' : 'percent'
  currentPage.value = props.progress.currentPage === null ? '' : String(props.progress.currentPage)
  progressPercent.value = props.progress.progressPercent === null ? '' : String(props.progress.progressPercent)
  startedAt.value = toDateInput(props.progress.startedAt)
  finishedAt.value = toDateInput(props.progress.finishedAt)
}

watch(
  () => props.open,
  (open) => {
    if (open) initializeState()
  }
)

watch(
  () => props.totalPages,
  (totalPages) => {
    if (!totalPages && progressMode.value === 'pages') {
      progressMode.value = 'percent'
    }
  }
)

const displayedPercent = computed(() => {
  if (progressMode.value === 'pages') {
    const page = parseOptionalNumber(currentPage.value)
    if (page !== null && props.totalPages && props.totalPages > 0) {
      return Math.min(100, Math.round((page / props.totalPages) * 100))
    }
  }

  return parseOptionalNumber(progressPercent.value) ?? 0
})

const hasChanges = computed(() => {
  const originalMode: ProgressMode = props.progress.currentPage !== null && props.totalPages ? 'pages' : 'percent'
  return status.value !== props.progress.status
    || progressMode.value !== originalMode
    || currentPage.value !== (props.progress.currentPage === null ? '' : String(props.progress.currentPage))
    || progressPercent.value !== (props.progress.progressPercent === null ? '' : String(props.progress.progressPercent))
    || startedAt.value !== toDateInput(props.progress.startedAt)
    || finishedAt.value !== toDateInput(props.progress.finishedAt)
})

function toDateInput(value: Date | string | null): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  const text = String(value ?? '').trim()
  if (text === '') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeOptionalNumber(value: unknown, max: number): number | null {
  const parsed = parseOptionalNumber(value)
  if (parsed === null) return null
  return clamp(Math.round(parsed), 0, max)
}

function selectStatus(nextStatus: ReadingStatus) {
  status.value = nextStatus
  if (nextStatus === 'unread') {
    currentPage.value = ''
    progressPercent.value = ''
    startedAt.value = ''
    finishedAt.value = ''
  } else if (nextStatus === 'read') {
    if (progressMode.value === 'pages' && props.totalPages) {
      currentPage.value = String(props.totalPages)
      progressPercent.value = ''
    } else {
      currentPage.value = ''
      progressPercent.value = '100'
    }
  }
}

function selectMode(mode: ProgressMode) {
  if (mode === progressMode.value) return

  const totalPages = props.totalPages
  if (!totalPages || totalPages <= 0) {
    progressMode.value = 'percent'
    return
  }

  if (mode === 'pages') {
    const percent = parseOptionalNumber(progressPercent.value)
    if (currentPage.value === '' && percent !== null) {
      currentPage.value = String(Math.min(totalPages, Math.max(0, Math.round((percent / 100) * totalPages))))
    }
  } else {
    const page = parseOptionalNumber(currentPage.value)
    if (page !== null) {
      progressPercent.value = String(Math.min(100, Math.max(0, Math.round((page / totalPages) * 100))))
    }
  }

  progressMode.value = mode
}

function saveProgress() {
  if (props.saving || !hasChanges.value) return

  emit('save:progress', {
    status: status.value,
    currentPage: progressMode.value === 'pages'
      ? normalizeOptionalNumber(currentPage.value, props.totalPages ?? Number.MAX_SAFE_INTEGER)
      : null,
    progressPercent: progressMode.value === 'percent'
      ? normalizeOptionalNumber(progressPercent.value, 100)
      : null,
    startedAt: startedAt.value || null,
    finishedAt: finishedAt.value || null
  })
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    title="Update Reading Progress"
    description="Track this book as unread, in progress, or read."
    :ui="{ content: 'sm:max-w-xl', footer: 'justify-end gap-2' }"
  >
    <template #body>
      <div class="space-y-5">
        <div>
          <h3 class="text-sm font-medium mb-2">
            Status
          </h3>
          <div class="grid gap-2 sm:grid-cols-3">
            <UButton
              v-for="item in statusItems"
              :key="item.value"
              type="button"
              :icon="item.icon"
              :color="status === item.value ? 'primary' : 'neutral'"
              :variant="status === item.value ? 'solid' : 'outline'"
              class="justify-center"
              @click="selectStatus(item.value)"
            >
              {{ item.label }}
            </UButton>
          </div>
        </div>

        <USeparator />

        <div>
          <h3 class="text-sm font-medium mb-2">
            Progress
          </h3>
          <div
            v-if="totalPages"
            class="grid gap-2 sm:grid-cols-2 mb-3"
          >
            <UButton
              type="button"
              icon="i-lucide-book-open"
              :color="progressMode === 'pages' ? 'primary' : 'neutral'"
              :variant="progressMode === 'pages' ? 'solid' : 'outline'"
              class="justify-center"
              @click="selectMode('pages')"
            >
              Pages
            </UButton>
            <UButton
              type="button"
              icon="i-lucide-percent"
              :color="progressMode === 'percent' ? 'primary' : 'neutral'"
              :variant="progressMode === 'percent' ? 'solid' : 'outline'"
              class="justify-center"
              @click="selectMode('percent')"
            >
              Percent
            </UButton>
          </div>

          <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-end">
            <UFormField
              v-if="progressMode === 'pages' && totalPages"
              :label="`Current page of ${totalPages}`"
            >
              <UInput
                v-model="currentPage"
                type="number"
                min="0"
                :max="totalPages"
                inputmode="numeric"
                icon="i-lucide-book-open"
                class="w-full"
                @keydown.meta.enter="saveProgress"
                @keydown.ctrl.enter="saveProgress"
              />
            </UFormField>

            <UFormField
              v-else
              label="Percent complete"
            >
              <UInput
                v-model="progressPercent"
                type="number"
                min="0"
                max="100"
                inputmode="numeric"
                icon="i-lucide-percent"
                class="w-full"
                @keydown.meta.enter="saveProgress"
                @keydown.ctrl.enter="saveProgress"
              />
            </UFormField>

            <div class="text-sm text-muted sm:text-right">
              {{ displayedPercent }}% done
            </div>
          </div>
        </div>

        <USeparator />

        <div>
          <h3 class="text-sm font-medium mb-2">
            Dates
          </h3>
          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="Started">
              <UInput
                v-model="startedAt"
                type="date"
                icon="i-lucide-calendar-days"
                class="w-full"
              />
            </UFormField>

            <UFormField label="Finished">
              <UInput
                v-model="finishedAt"
                type="date"
                icon="i-lucide-calendar-check"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        :disabled="saving"
        @click="modalOpen = false"
      >
        Cancel
      </UButton>
      <UButton
        icon="i-lucide-save"
        :loading="saving"
        :disabled="saving || !hasChanges"
        @click="saveProgress"
      >
        Save Changes
      </UButton>
    </template>
  </UModal>
</template>
