<script setup lang="ts">
const toast = useToast()

const bulkIsbnText = ref('')

const {
  scannedBooks,
  isLookingUp,
  isAddingBooks,
  counts,
  addMultipleIsbns,
  removeIsbn,
  toggleSelection,
  selectAll,
  deselectAll,
  addSelectedToLibrary,
  clearAll
} = useIsbnScanner()

async function handleBulkImport() {
  if (!bulkIsbnText.value.trim()) {
    toast.add({
      title: 'No ISBNs entered',
      description: 'Please enter at least one ISBN',
      color: 'warning'
    })
    return
  }

  await addMultipleIsbns(bulkIsbnText.value)
  bulkIsbnText.value = ''
}

async function handleAddSelected() {
  const result = await addSelectedToLibrary()
  if (result.success.length > 0 && result.failed.length === 0) {
    navigateTo('/library')
  }
}

function reset() {
  bulkIsbnText.value = ''
  clearAll()
}

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
          class="w-full font-mono text-sm"
          @keydown.meta.enter="handleBulkImport"
          @keydown.ctrl.enter="handleBulkImport"
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
    <BulkScanReview
      v-else
      :scanned-books="scannedBooks"
      :is-adding-books="isAddingBooks"
      :counts="counts"
      @remove="removeIsbn"
      @toggle="toggleSelection"
      @select-all="selectAll"
      @deselect-all="deselectAll"
      @add-selected="handleAddSelected"
      @clear-all="clearAll"
    />
  </UCard>
</template>
