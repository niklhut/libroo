<script setup lang="ts">
import type { ScannedBook } from '~/composables/useIsbnScanner'

const props = defineProps<{
  scannedBooks: ScannedBook[]
  isAddingBooks: boolean
  counts: {
    total: number
    selected: number
    found: number
    loading: number
    notFound: number
    alreadyOwned: number
    errors: number
  }
}>()

const emit = defineEmits<{
  remove: [isbn: string]
  toggle: [isbn: string]
  selectAll: []
  deselectAll: []
  addSelected: []
  clearAll: []
}>()

// Track expanded book for showing full details
const expandedIsbn = ref<string | null>(null)

function toggleExpanded(isbn: string) {
  expandedIsbn.value = expandedIsbn.value === isbn ? null : isbn
}

function getStatusColor(status: ScannedBook['status']) {
  switch (status) {
    case 'loading': return 'neutral'
    case 'found': return 'success'
    case 'not_found': return 'warning'
    case 'already_owned': return 'info'
    case 'error': return 'error'
    default: return 'neutral'
  }
}

function getStatusIcon(status: ScannedBook['status']) {
  switch (status) {
    case 'loading': return 'i-lucide-loader-2'
    case 'found': return 'i-lucide-check'
    case 'not_found': return 'i-lucide-search-x'
    case 'already_owned': return 'i-lucide-book-check'
    case 'error': return 'i-lucide-alert-circle'
    default: return 'i-lucide-clock'
  }
}

function getStatusText(status: ScannedBook['status']) {
  switch (status) {
    case 'loading': return 'Looking up...'
    case 'found': return 'Found'
    case 'not_found': return 'Not found'
    case 'already_owned': return 'Already in library'
    case 'error': return 'Error'
    default: return 'Pending'
  }
}
</script>

<template>
  <div class="bulk-scan-review">
    <!-- Header with stats and actions -->
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="text-sm text-muted">
          {{ counts.total }} scanned
        </span>
        <UBadge
          v-if="counts.found > 0"
          color="success"
          variant="subtle"
          size="md"
        >
          {{ counts.found }} found
        </UBadge>
        <UBadge
          v-if="counts.alreadyOwned > 0"
          color="info"
          variant="subtle"
          size="md"
        >
          {{ counts.alreadyOwned }} owned
        </UBadge>
        <UBadge
          v-if="counts.notFound > 0"
          color="warning"
          variant="subtle"
          size="md"
        >
          {{ counts.notFound }} not found
        </UBadge>
      </div>

      <div class="flex items-center gap-2">
        <UButton
          v-if="counts.found > 0"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="$emit('selectAll')"
        >
          Select All
        </UButton>
        <UButton
          v-if="counts.selected > 0"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="$emit('deselectAll')"
        >
          Deselect All
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          @click="$emit('clearAll')"
        >
          Clear All
        </UButton>
      </div>
    </div>

    <!-- Book list -->
    <div class="space-y-3">
      <div
        v-for="book in scannedBooks"
        :key="book.isbn"
        class="rounded-lg transition-colors overflow-hidden"
        :class="[
          book.selected ? 'bg-primary/5 border border-primary/20' : 'bg-neutral-50 dark:bg-neutral-900 border border-transparent'
        ]"
      >
        <!-- Main row - clickable for found books -->
        <div
          class="flex gap-4 p-3"
          :class="[
            book.result?.found ? 'items-start' : 'items-center',
            { 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800/50': book.result?.found }
          ]"
          @click="book.result?.found ? toggleExpanded(book.isbn) : undefined"
        >
          <!-- Checkbox (only for found books) or status icon -->
          <template v-if="book.status === 'found'">
            <div class="pt-1" @click.stop>
              <UCheckbox
                :model-value="book.selected"
                @update:model-value="$emit('toggle', book.isbn)"
              />
            </div>
          </template>
          <UIcon
            v-else
            :name="getStatusIcon(book.status)"
            class="text-xl flex-shrink-0"
            :class="{
              'animate-spin text-primary': book.status === 'loading',
              'text-warning': book.status === 'not_found',
              'text-info': book.status === 'already_owned',
              'text-error': book.status === 'error'
            }"
          />

          <!-- Book info -->
          <div class="flex-1 min-w-0">
            <template v-if="book.result?.found">
              <div class="flex items-start gap-3">
                <!-- Cover thumbnail -->
                <div class="w-14 h-20 flex-shrink-0 rounded overflow-hidden bg-neutral-200 dark:bg-neutral-800">
                  <NuxtImg
                    v-if="book.result.coverUrl"
                    :src="book.result.coverUrl"
                    :alt="book.result.title || 'Book cover'"
                    class="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div
                    v-else
                    class="w-full h-full flex items-center justify-center"
                  >
                    <UIcon
                      name="i-lucide-book"
                      class="text-neutral-400 text-xl"
                    />
                  </div>
                </div>

                <!-- Details -->
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-base">
                    {{ book.result.title }}
                  </p>
                  <p class="text-sm text-muted">
                    {{ book.result.author }}
                  </p>
                  <div class="flex items-center gap-2 mt-2 flex-wrap">
                    <UBadge
                      :color="getStatusColor(book.status)"
                      variant="subtle"
                      size="md"
                    >
                      <UIcon
                        :name="getStatusIcon(book.status)"
                        class="mr-1"
                      />
                      {{ getStatusText(book.status) }}
                    </UBadge>
                    <UBadge
                      color="neutral"
                      variant="subtle"
                      size="md"
                    >
                      {{ book.isbn }}
                    </UBadge>
                  </div>
                </div>
              </div>
            </template>

            <template v-else>
              <!-- No result yet or not found -->
              <div class="flex items-center gap-3">
                <span class="font-mono">
                  {{ book.isbn }}
                </span>
                <UBadge
                  v-if="book.status !== 'loading'"
                  :color="getStatusColor(book.status)"
                  variant="subtle"
                  size="md"
                >
                  <UIcon
                    :name="getStatusIcon(book.status)"
                    class="mr-1"
                  />
                  {{ getStatusText(book.status) }}
                </UBadge>
              </div>
              <p
                v-if="book.errorMessage"
                class="text-sm text-error mt-2"
              >
                {{ book.errorMessage }}
              </p>
              <p
                v-else-if="book.result?.message"
                class="text-sm text-muted mt-2"
              >
                {{ book.result.message }}
              </p>
            </template>
          </div>

          <!-- Right side: Remove button (and chevron for found books) -->
          <div
            class="flex items-center"
            :class="{ 'flex-col gap-1': book.result?.found }"
          >
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-x"
              @click.stop="$emit('remove', book.isbn)"
            />
            <UIcon
              v-if="book.result?.found"
              :name="expandedIsbn === book.isbn ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="text-muted text-lg"
            />
          </div>
        </div>

        <!-- Expanded details -->
        <div
          v-if="expandedIsbn === book.isbn && book.result?.found"
          class="px-4 pb-4 pt-2 border-t border-neutral-200 dark:border-neutral-800 space-y-4"
        >
          <!-- Description -->
          <div v-if="book.result.description">
            <p class="text-sm font-medium mb-1">Description</p>
            <p class="text-sm text-muted">
              {{ book.result.description }}
            </p>
          </div>

          <!-- Book metadata row -->
          <div class="flex flex-wrap gap-3">
            <UBadge
              v-if="book.result.publishDate"
              color="neutral"
              variant="subtle"
              size="md"
            >
              <UIcon name="i-lucide-calendar" class="mr-1" />
              {{ book.result.publishDate }}
            </UBadge>
            <UBadge
              v-if="book.result.numberOfPages"
              color="neutral"
              variant="subtle"
              size="md"
            >
              <UIcon name="i-lucide-book-open" class="mr-1" />
              {{ book.result.numberOfPages }} pages
            </UBadge>
            <UBadge
              v-if="book.result.publishers && book.result.publishers.length > 0"
              color="neutral"
              variant="subtle"
              size="md"
            >
              <UIcon name="i-lucide-building" class="mr-1" />
              {{ book.result.publishers.join(', ') }}
            </UBadge>
          </div>

          <!-- Subjects -->
          <div v-if="book.result.subjects && book.result.subjects.length > 0">
            <p class="text-sm font-medium mb-2">Subjects</p>
            <div class="flex flex-wrap gap-2">
              <UBadge
                v-for="subject in book.result.subjects.slice(0, 8)"
                :key="subject"
                color="secondary"
                variant="subtle"
                size="md"
              >
                {{ subject }}
              </UBadge>
              <span
                v-if="book.result.subjects.length > 8"
                class="text-sm text-muted self-center"
              >
                +{{ book.result.subjects.length - 8 }} more
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div
      v-if="scannedBooks.length === 0"
      class="text-center py-8 text-muted"
    >
      <UIcon
        name="i-lucide-scan-barcode"
        class="text-4xl mb-2 opacity-50"
      />
      <p>No books scanned yet</p>
    </div>

    <!-- Add selected button -->
    <div
      v-if="counts.selected > 0"
      class="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800"
    >
      <UButton
        block
        size="lg"
        :loading="isAddingBooks"
        @click="$emit('addSelected')"
      >
        <UIcon
          name="i-lucide-plus"
          class="mr-2"
        />
        Add {{ counts.selected }} Book{{ counts.selected > 1 ? 's' : '' }} to Library
      </UButton>
    </div>
  </div>
</template>
