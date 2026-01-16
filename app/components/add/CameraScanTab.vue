<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

const toast = useToast()

const continuousMode = ref(false)
const showScanner = ref(false)

const isLookingUp = ref(false)
const isAdding = ref(false)
const lookupResult = ref<BookLookupResult | null>(null)

// Bulk scanner composable for continuous mode
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

// Handle scanned ISBN
function onIsbnDetected(isbn: string) {
  if (continuousMode.value) {
    addIsbn(isbn)
  } else {
    showScanner.value = false
    lookupSingleIsbn(isbn)
  }
}

// Lookup single ISBN (for single scan mode)
async function lookupSingleIsbn(isbn: string) {
  isLookingUp.value = true
  lookupResult.value = null

  try {
    const result = await $fetch<BookLookupResult>('/api/books/lookup', {
      method: 'POST',
      body: { isbn }
    })
    lookupResult.value = result

    if (!result.found) {
      toast.add({
        title: 'Book not found',
        description: result.message || 'Could not find this book on OpenLibrary',
        color: 'warning'
      })
    }
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (err as { data?: { message?: string } })?.data?.message || 'Failed to lookup book'
    toast.add({
      title: 'Lookup failed',
      description: message,
      color: 'error'
    })
  } finally {
    isLookingUp.value = false
  }
}

// Add book to library (single scan mode)
async function addBookToLibrary() {
  if (!lookupResult.value?.found) return

  isAdding.value = true

  try {
    await $fetch('/api/books', {
      method: 'POST',
      body: { isbn: lookupResult.value.isbn }
    })

    toast.add({
      title: 'Book added!',
      description: `${lookupResult.value.title} has been added to your library`,
      color: 'success'
    })

    navigateTo('/library')
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (err as { data?: { message?: string } })?.data?.message || 'Failed to add book'
    toast.add({
      title: 'Failed to add book',
      description: message,
      color: 'error'
    })
  } finally {
    isAdding.value = false
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
  lookupResult.value = null
  showScanner.value = true
}

function reset() {
  lookupResult.value = null
  showScanner.value = false
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
          v-if="!lookupResult?.found || continuousMode"
          class="flex items-center gap-2"
        >
          <span class="text-sm text-muted">Continuous</span>
          <USwitch v-model="continuousMode" />
        </div>
      </div>
    </template>

    <!-- Single scan result preview -->
    <template v-if="!continuousMode && lookupResult?.found">
      <BookPreview
        :book="lookupResult"
        :is-adding="isAdding"
        @add="addBookToLibrary"
        @back="resetLookup"
        back-label="Scan Again"
        back-icon="i-lucide-scan-barcode"
      />
    </template>

    <!-- Loading state for single scan -->
    <template v-else-if="!continuousMode && isLookingUp">
      <div class="text-center py-8">
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-3xl text-primary mb-3"
        />
        <p class="text-muted">Looking up book...</p>
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
