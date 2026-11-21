<script setup lang="ts">
import type { LibraryImportResult, LibraryImportRowDetail } from '~~/shared/types/library-transfer'

const props = defineProps<{ result: LibraryImportResult }>()
const open = ref(false)
const filter = ref('all')
const items = [
  { label: 'All rows', value: 'all' },
  { label: 'Already in library before import', value: 'matched' },
  { label: 'Repeated in this CSV', value: 'repeated' },
  { label: 'Errors and unfinished rows', value: 'errors' }
]
const details = computed<LibraryImportRowDetail[]>(() => props.result.details ?? props.result.failed.map(failure => ({ ...failure, status: 'failed' as const })))
const isLibraryMatch = (row: LibraryImportRowDetail) => (row.status === 'updated' || row.status === 'skipped') && row.repeatedInFile === false
const visible = computed(() => details.value.filter(row => filter.value === 'all'
  || (filter.value === 'matched' && isLibraryMatch(row))
  || (filter.value === 'repeated' && 'repeatedInFile' in row && row.repeatedInFile)
  || (filter.value === 'errors' && ['failed', 'unconfirmed', 'not_processed'].includes(row.status))))
const matchedCount = computed(() => props.result.updated + props.result.skipped)
const libraryMatches = computed(() => details.value.filter(isLibraryMatch).length)
const repeats = computed(() => details.value.filter(row => row.repeatedInFile === true && (row.status === 'updated' || row.status === 'skipped')).length)
const unknownMatches = computed(() => Math.max(0, matchedCount.value - libraryMatches.value - repeats.value))
const matchLabels = { libroo_id: 'Libroo record ID', isbn: 'ISBN', title_authors: 'title and author' }
watch(() => props.result, () => {
  open.value = false
  filter.value = 'all'
})
</script>

<template>
  <div class="space-y-3">
    <template v-if="matchedCount">
      <template v-if="!unknownMatches">
        <p class="text-sm text-muted">
          Already in your library before import: {{ libraryMatches }} {{ libraryMatches === 1 ? 'book' : 'books' }} matched.
        </p>
        <p class="text-sm text-muted">
          Repeated within this CSV: {{ repeats }} {{ repeats === 1 ? 'row' : 'rows' }} matched records handled at an earlier CSV row.
        </p>
      </template>
      <p
        v-else
        class="text-sm text-muted"
      >
        {{ matchedCount }} updated or skipped rows matched library records. Match origins are unavailable for {{ unknownMatches }} {{ unknownMatches === 1 ? 'row' : 'rows' }} in this report; these cannot be classified as pre-existing books or CSV repeats.
      </p>
      <p class="text-sm text-muted">
        {{ repeats ? 'Repeated rows are included in the updated/skipped totals above; they do not create additional books. ' : '' }}Matches can occur across locations.
      </p>
    </template>
    <UCollapsible
      v-model:open="open"
      class="space-y-3"
    >
      <UButton
        color="neutral"
        variant="outline"
        :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :aria-expanded="open"
      >
        {{ open ? 'Hide row details' : 'Show row details' }} ({{ details.length }})
      </UButton>
      <template #content>
        <div class="space-y-3">
          <USelect
            v-model="filter"
            :items="items"
            aria-label="Filter import details"
            class="w-full"
          />
          <p
            v-if="!visible.length"
            class="text-sm text-muted"
          >
            {{ details.length ? 'No rows match this filter.' : 'Row details are unavailable for this report.' }}
          </p>
          <ul
            v-else
            class="max-h-80 divide-y divide-default overflow-y-auto"
            aria-label="Import row details"
          >
            <li
              v-for="row in visible"
              :key="row.row"
              class="space-y-1 py-3 text-sm"
            >
              <div class="flex flex-wrap items-center gap-2">
                <UBadge
                  :color="row.status === 'failed' ? 'error' : ['unconfirmed', 'not_processed'].includes(row.status) ? 'warning' : 'neutral'"
                  variant="soft"
                >
                  {{ row.status.replaceAll('_', ' ') }}
                </UBadge>
                <span class="font-medium">Row {{ row.row }}: {{ row.title }}</span>
              </div>
              <p
                v-if="'matchedBy' in row && row.matchedBy"
                class="text-muted"
              >
                Matched {{ row.matchedTitle ? `“${row.matchedTitle}”` : 'an existing book' }} by {{ matchLabels[row.matchedBy] }}.
              </p>
              <p
                v-if="isLibraryMatch(row)"
                class="text-muted"
              >
                Already in your library before this import.
              </p>
              <p
                v-if="'repeatedInFile' in row && row.repeatedInFile"
                class="text-muted"
              >
                Repeated in this CSV; the same library record was handled at row {{ row.firstRow }}.
              </p>
              <p
                v-if="row.reason"
                class="whitespace-pre-wrap text-muted"
              >
                {{ row.reason }}
              </p>
              <NuxtLink
                v-if="'userBookId' in row && row.userBookId"
                :to="`/library/${row.userBookId}`"
                target="_blank"
                class="text-primary underline"
              >{{ row.status === 'created' ? 'View imported book' : 'View matched book' }}</NuxtLink>
            </li>
          </ul>
        </div>
      </template>
    </UCollapsible>
  </div>
</template>
