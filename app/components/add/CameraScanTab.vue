<script setup lang="ts">
const toast = useToast()

const continuousMode = ref(false)
const showScanner = ref(false)

// Use composable for both single and continuous modes
const {
  scannedBooks,
  isAddingBooks,
  counts,
  addIsbn,
  removeIsbn,
  toggleSelection,
  selectAll,
  deselectAll,
  addSelectedToLibrary,
  clearAll
} = useIsbnScanner()

// In single mode, the first scanned book is our current lookup result
const singleScanBook = computed(() =>
  !continuousMode.value && scannedBooks.value.length === 1
    ? scannedBooks.value[0]
    : null
)

// Handle scanned ISBN
async function onIsbnDetected(isbn: string) {
  if (continuousMode.value) {
    addIsbn(isbn)
  } else {
    // Single mode: clear previous and add new
    clearAll()
    showScanner.value = false
    await addIsbn(isbn)

    // Show toast for not found
    const book = scannedBooks.value[0]
    if (book?.status === 'not_found') {
      toast.add({
        title: 'Book not found',
        description: book.result?.message || 'Could not find this book on OpenLibrary',
        color: 'warning'
      })
    } else if (book?.status === 'error') {
      toast.add({
        title: 'Lookup failed',
        description: book.errorMessage || 'Failed to lookup book',
        color: 'error'
      })
    }
  }
}

// Add book to library (single scan mode) - uses composable's addSelectedToLibrary
async function addBookToLibrary() {
  const result = await addSelectedToLibrary()
  if (result.success.length > 0 && result.failed.length === 0) {
    navigateTo('/library')
  }
}

// Handle adding selected books in continuous mode
async function handleAddSelected() {
  const result = await addSelectedToLibrary()
  if (result.success.length > 0 && result.failed.length === 0) {
    navigateTo('/library')
  }
}

function resetLookup() {
  clearAll()
  showScanner.value = true
}

function reset() {
  showScanner.value = false
  clearAll()
}

defineExpose({ reset })
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-scan-barcode"
            class="text-lg"
          />
          <span class="font-semibold">Scan Barcode</span>
        </div>

        <!-- Continuous mode toggle (hide when showing single result) -->
        <div
          v-if="!singleScanBook?.result?.found || continuousMode"
          class="flex items-center gap-2"
        >
          <span class="text-sm text-muted">Continuous</span>
          <USwitch v-model="continuousMode" />
        </div>
      </div>
    </template>

    <!-- Single scan result preview -->
    <template v-if="singleScanBook?.result?.found">
      <BookPreview
        :book="singleScanBook.result"
        :is-adding="isAddingBooks"
        back-label="Scan Again"
        back-icon="i-lucide-scan-barcode"
        @add="addBookToLibrary"
        @back="resetLookup"
      />
    </template>

    <!-- Loading state for single scan -->
    <template v-else-if="singleScanBook?.status === 'loading'">
      <div class="text-center py-8">
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-3xl text-primary mb-3"
        />
        <p class="text-muted">
          Looking up book...
        </p>
      </div>
    </template>

    <!-- Scanner start prompt -->
    <template v-else-if="!showScanner">
      <div class="text-center py-8">
        <UIcon
          name="i-lucide-camera"
          class="text-5xl text-primary mb-4"
        />
        <p class="text-muted mb-4">
          <template v-if="continuousMode">
            Scan multiple book barcodes in a row
          </template>
          <template v-else>
            Scan a book barcode to look it up
          </template>
        </p>
        <UButton
          icon="i-lucide-camera"
          size="lg"
          @click="showScanner = true"
        >
          Start Camera
        </UButton>
      </div>
    </template>

    <!-- Active scanner -->
    <template v-else>
      <IsbnScanner
        :continuous="continuousMode"
        @detected="onIsbnDetected"
      />

      <div class="mt-4 flex justify-center">
        <UButton
          icon="i-lucide-camera-off"
          color="neutral"
          variant="outline"
          @click="showScanner = false"
        >
          Stop Camera
        </UButton>
      </div>
    </template>

    <!-- Results list (continuous mode) -->
    <template v-if="continuousMode && scannedBooks.length > 0">
      <USeparator class="my-4" />
      <BulkScanReview
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
    </template>
  </UCard>
</template>
