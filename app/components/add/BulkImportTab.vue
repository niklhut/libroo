<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { DEFAULT_LIBRARY_PAGE_SIZE, buildLibraryRouteQuery } from '~~/shared/utils/library-query'
import { MAX_BULK_ISBN_INPUT_BYTES } from '~~/shared/utils/schemas'

const toast = useToast()

const bulkIsbnText = ref('')
const bulkIsbnCount = computed(() => bulkIsbnText.value.split(/[\n,\s]+/).filter(Boolean).length)

const scannerStore = useIsbnScannerStore()
const {
  scannedBooks,
  targetLibraryState,
  isLookingUp,
  isAddingBooks,
  counts
} = storeToRefs(scannerStore)

const {
  addMultipleIsbns,
  removeIsbn,
  retryIsbn,
  toggleSelection,
  selectAll,
  deselectAll,
  addSelectedToLibrary,
  clearAll
} = scannerStore

async function handleBulkImport() {
  if (!bulkIsbnText.value.trim()) {
    toast.add({
      title: 'No ISBNs entered',
      description: 'Please enter at least one ISBN',
      color: 'warning'
    })
    return
  }

  if (await addMultipleIsbns(bulkIsbnText.value)) {
    bulkIsbnText.value = ''
  }
}

async function handleAddSelected() {
  const result = await addSelectedToLibrary()
  if (result.success.length > 0 && result.failed.length === 0) {
    const query = new URLSearchParams(buildLibraryRouteQuery({
      page: 1,
      pageSize: DEFAULT_LIBRARY_PAGE_SIZE,
      libraryState: [targetLibraryState.value]
    }))
    const queryString = query.toString()
    navigateTo(queryString ? `/library?${queryString}` : '/library')
  }
}

function reset() {
  bulkIsbnText.value = ''
  clearAll()
}

onUnmounted(reset)

defineExpose({ reset })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-list"
          class="text-lg"
        />
        <span class="font-semibold">Bulk Import</span>
      </div>
    </template>

    <!-- ISBN input textarea -->
    <div
      v-if="scannedBooks.length === 0"
      class="space-y-4"
    >
      <UFormField
        label="Enter ISBNs"
        hint="One per line, or separated by commas."
      >
        <UTextarea
          v-model="bulkIsbnText"
          placeholder="9780385533225&#10;9780141439518&#10;9780743273565"
          :rows="6"
          :maxlength="MAX_BULK_ISBN_INPUT_BYTES"
          class="w-full font-mono text-sm"
          @keydown.meta.enter="handleBulkImport"
          @keydown.ctrl.enter="handleBulkImport"
        />
      </UFormField>

      <p class="text-sm text-muted">
        {{ bulkIsbnText.length.toLocaleString() }} / {{ MAX_BULK_ISBN_INPUT_BYTES.toLocaleString() }} characters · {{ bulkIsbnCount }} ISBN{{ bulkIsbnCount === 1 ? '' : 's' }} detected
      </p>

      <UFormField label="Add as">
        <USelect
          v-model="targetLibraryState"
          :items="libraryStateItems"
          class="w-full"
        />
      </UFormField>

      <p class="text-sm text-muted">
        Enter multiple ISBNs to look them all up at once. You can paste a list from a spreadsheet or text file.
      </p>

      <UButton
        icon="i-lucide-search"
        block
        size="lg"
        :loading="isLookingUp"
        :disabled="!bulkIsbnText.trim()"
        @click="handleBulkImport"
      >
        Look Up All
      </UButton>
    </div>

    <!-- Results -->
    <div
      v-else
      class="space-y-4"
    >
      <UFormField label="Add selected as">
        <USelect
          v-model="targetLibraryState"
          :items="libraryStateItems"
          class="w-full"
        />
      </UFormField>

      <BulkScanReview
        :scanned-books="scannedBooks"
        :is-adding-books="isAddingBooks"
        :counts="counts"
        :target-library-state="targetLibraryState"
        @remove="removeIsbn"
        @retry="retryIsbn"
        @toggle="toggleSelection"
        @select-all="selectAll"
        @deselect-all="deselectAll"
        @add-selected="handleAddSelected"
        @clear-all="clearAll"
      />
    </div>
  </UCard>
</template>
