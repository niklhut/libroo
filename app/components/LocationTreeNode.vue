<script setup lang="ts">
import type { BookLocationTreeNode, BookLocationWithCount } from '~~/shared/types/book'

defineOptions({ name: 'LocationTreeNode' })

const props = defineProps<{
  node: BookLocationTreeNode
  locations: BookLocationWithCount[]
}>()

const emit = defineEmits<{
  add: [parentLocationId: string, name: string]
  rename: [locationId: string, name: string]
  move: [locationId: string, parentLocationId: string | null]
  delete: [location: BookLocationWithCount]
}>()

const isAdding = ref(false)
const isRenaming = ref(false)
const newChildName = ref('')
const renameName = ref(props.node.name)
const TOP_LEVEL_VALUE = '__top_level__'
const selectedParentId = ref(props.node.parentLocationId ?? TOP_LEVEL_VALUE)

const affectedBookCount = computed(() => props.node.directBookCount + props.node.descendantBookCount)
const canSubmitChild = computed(() => newChildName.value.trim().length > 0)
const canSubmitRename = computed(() => renameName.value.trim().length > 0 && renameName.value.trim() !== props.node.name)
const selectedParentLocationId = computed(() =>
  selectedParentId.value === TOP_LEVEL_VALUE ? null : selectedParentId.value
)
const moveOptions = computed(() => [
  { label: 'Top level', value: TOP_LEVEL_VALUE },
  ...props.locations
    .filter(location => location.id !== props.node.id && !location.path.startsWith(`${props.node.path} - `))
    .map(location => ({ label: location.path, value: location.id }))
])

function addChild() {
  const name = newChildName.value.trim()
  if (!name) return
  emit('add', props.node.id, name)
  newChildName.value = ''
  isAdding.value = false
}

function renameLocation() {
  const name = renameName.value.trim()
  if (!name || name === props.node.name) return
  emit('rename', props.node.id, name)
  isRenaming.value = false
}

function moveLocation() {
  emit('move', props.node.id, selectedParentLocationId.value)
}

watch(
  () => props.node,
  (node) => {
    renameName.value = node.name
    selectedParentId.value = node.parentLocationId ?? TOP_LEVEL_VALUE
  }
)
</script>

<template>
  <li>
    <div class="rounded-md border border-default bg-default p-4">
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-corner-down-right"
              class="text-muted"
            />
            <div class="min-w-0">
              <p class="truncate font-medium text-highlighted">
                {{ node.name }}
              </p>
              <p class="truncate text-sm text-muted">
                {{ node.path }}
              </p>
            </div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 pl-9 text-sm">
            <UBadge
              color="neutral"
              variant="soft"
            >
              {{ node.directBookCount }} direct
            </UBadge>
            <UBadge
              color="neutral"
              variant="soft"
            >
              {{ node.descendantBookCount }} nested
            </UBadge>
            <UBadge
              :color="affectedBookCount === 0 ? 'success' : 'primary'"
              variant="soft"
            >
              {{ affectedBookCount }} total {{ affectedBookCount === 1 ? 'book' : 'books' }}
            </UBadge>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-plus"
            @click="isAdding = !isAdding"
          >
            Add
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-pencil"
            @click="isRenaming = !isRenaming"
          >
            Rename
          </UButton>
          <UButton
            color="error"
            variant="outline"
            size="sm"
            icon="i-lucide-trash-2"
            @click="emit('delete', node)"
          >
            Delete
          </UButton>
        </div>
      </div>

      <div
        v-if="isAdding"
        class="mt-4 flex gap-2 pl-9"
      >
        <UInput
          v-model="newChildName"
          icon="i-lucide-map-pin-plus"
          placeholder="Sub-location name"
          class="flex-1"
          @keyup.enter="addChild"
        />
        <UButton
          icon="i-lucide-plus"
          :disabled="!canSubmitChild"
          @click="addChild"
        >
          Add
        </UButton>
      </div>

      <div
        v-if="isRenaming"
        class="mt-4 grid gap-2 pl-9 md:grid-cols-[minmax(0,1fr)_auto]"
      >
        <UInput
          v-model="renameName"
          icon="i-lucide-pencil"
          placeholder="Location name"
          @keyup.enter="renameLocation"
        />
        <UButton
          icon="i-lucide-save"
          :disabled="!canSubmitRename"
          @click="renameLocation"
        >
          Save
        </UButton>
      </div>

      <div class="mt-4 grid gap-2 pl-9 md:grid-cols-[minmax(0,1fr)_auto]">
        <USelect
          v-model="selectedParentId"
          :items="moveOptions"
          icon="i-lucide-corner-down-right"
          class="w-full"
        />
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-move"
          :disabled="selectedParentLocationId === node.parentLocationId"
          @click="moveLocation"
        >
          Move
        </UButton>
      </div>
    </div>
  </li>
</template>
