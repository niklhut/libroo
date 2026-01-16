<script setup lang="ts">
// Input mode tabs
type InputMode = 'manual' | 'scan' | 'bulk'
const inputMode = ref<InputMode>('manual')

// Refs to child components for resetting state on tab change
const isbnLookupRef = ref<{ resetLookup: () => void } | null>(null)
const cameraScanRef = ref<{ reset: () => void } | null>(null)
const bulkImportRef = ref<{ reset: () => void } | null>(null)

// Tab items
const modeItems = [
  { value: 'manual', label: 'ISBN Lookup', icon: 'i-lucide-keyboard' },
  { value: 'scan', label: 'Camera Scan', icon: 'i-lucide-scan-barcode' },
  { value: 'bulk', label: 'Bulk Import', icon: 'i-lucide-list' }
]

// Reset child component state when switching modes
watch(inputMode, () => {
  isbnLookupRef.value?.resetLookup()
  cameraScanRef.value?.reset()
  bulkImportRef.value?.reset()
})
</script>

<template>
  <UContainer>
    <!-- Page Header -->
    <UPageHeader
      title="Add Book"
      description="Add books to your library by entering an ISBN, scanning a barcode, or importing multiple books at once."
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
            v-if="inputMode === 'manual'"
            ref="isbnLookupRef"
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

          <!-- Future: Manual entry option -->
          <div class="mt-6 text-center">
            <p class="text-sm text-muted">
              Can't find your book? Manual entry coming soon.
            </p>
          </div>
        </div>
      </div>
    </UPageBody>
  </UContainer>
</template>
