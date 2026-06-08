<script setup lang="ts">
// Input mode tabs
type InputMode = 'isbn' | 'manual' | 'scan' | 'bulk'
const route = useRoute()
const router = useRouter()

const validInputModes = ['isbn', 'manual', 'scan', 'bulk'] as const

function isInputMode(value: unknown): value is InputMode {
  return typeof value === 'string' && validInputModes.includes(value as InputMode)
}

const inputMode = ref<InputMode>(isInputMode(route.query.tab) ? route.query.tab : 'isbn')

// Refs to child components for resetting state on tab change
const isbnLookupRef = ref<{ reset: () => void } | null>(null)
const manualEntryRef = ref<{ reset: () => void } | null>(null)
const cameraScanRef = ref<{ reset: () => void } | null>(null)
const bulkImportRef = ref<{ reset: () => void } | null>(null)

// Tab items
const modeItems = [
  { value: 'isbn', label: 'ISBN Lookup', icon: 'i-lucide-keyboard' },
  { value: 'manual', label: 'Manual Entry', icon: 'i-lucide-pencil-line' },
  { value: 'scan', label: 'Camera Scan', icon: 'i-lucide-scan-barcode' },
  { value: 'bulk', label: 'Bulk Import', icon: 'i-lucide-list' }
]

watch(
  () => route.query.tab,
  (tab) => {
    if (isInputMode(tab) && tab !== inputMode.value) {
      inputMode.value = tab
    }
  }
)

// Reset child component state when switching modes and persist the selected tab.
watch(inputMode, (mode, previousMode) => {
  if (mode !== route.query.tab) {
    router.replace({
      query: {
        ...route.query,
        tab: mode
      }
    })
  }

  if (!previousMode || mode === previousMode) return

  isbnLookupRef.value?.reset()
  manualEntryRef.value?.reset()
  cameraScanRef.value?.reset()
  bulkImportRef.value?.reset()
})
</script>

<template>
  <UContainer>
    <!-- Page Header -->
    <UPageHeader
      title="Add Book"
      description="Add books to your library by entering details manually, looking up an ISBN, scanning a barcode, or importing multiple books at once."
    >
      <template #links>
        <UButton
          to="/library"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
        >
          Back to Library
        </UButton>
      </template>
    </UPageHeader>

    <!-- Page Body -->
    <UPageBody>
      <div class="flex justify-center">
        <div class="w-full max-w-xl">
          <!-- Mode Tabs -->
          <UTabs
            v-model="inputMode"
            :items="modeItems"
            :content="false"
            variant="link"
            class="mb-6"
          />

          <!-- ISBN Lookup Mode -->
          <AddIsbnLookupTab
            v-if="inputMode === 'isbn'"
            ref="isbnLookupRef"
          />

          <!-- Manual Entry Mode -->
          <AddManualEntryTab
            v-else-if="inputMode === 'manual'"
            ref="manualEntryRef"
          />

          <!-- Camera Scan Mode -->
          <AddCameraScanTab
            v-else-if="inputMode === 'scan'"
            ref="cameraScanRef"
          />

          <!-- Bulk Import Mode -->
          <AddBulkImportTab
            v-else-if="inputMode === 'bulk'"
            ref="bulkImportRef"
          />
        </div>
      </div>
    </UPageBody>
  </UContainer>
</template>
