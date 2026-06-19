<script setup lang="ts">
import type { BookLocationTreeNode, BookLocationWithCount } from '~~/shared/types/book'
import LocationTreeNode from '~~/app/components/LocationTreeNode.vue'

usePageTitle('Locations')

const toast = useToast()

const newLocationName = ref('')
const isCreating = ref(false)
const isMutating = ref(false)
const deleteTarget = ref<BookLocationWithCount | null>(null)
const deleteMode = ref<'block' | 'clear' | 'move'>('block')
const deleteTargetLocationId = ref<string>()

const { data: locations, refresh, status } = await useFetch<BookLocationWithCount[]>('/api/locations', {
  headers: useRequestHeaders(['cookie'])
})

const locationTree = computed<BookLocationTreeNode[]>(() => {
  const nodes = new Map<string, BookLocationTreeNode>()
  for (const location of locations.value ?? []) {
    nodes.set(location.id, { ...location, children: [] })
  }

  const roots: BookLocationTreeNode[] = []
  for (const node of nodes.values()) {
    if (node.parentLocationId && nodes.has(node.parentLocationId)) {
      nodes.get(node.parentLocationId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (items: BookLocationTreeNode[]) => {
    items.sort((a, b) => a.name.localeCompare(b.name))
    for (const item of items) sortNodes(item.children)
  }

  sortNodes(roots)
  return roots
})

const flattenedLocationTree = computed(() => {
  const nodes: BookLocationTreeNode[] = []
  const visit = (node: BookLocationTreeNode) => {
    nodes.push(node)
    for (const child of node.children) visit(child)
  }

  for (const root of locationTree.value) visit(root)
  return nodes
})

const deleteMoveOptions = computed(() => {
  const target = deleteTarget.value
  return (locations.value ?? [])
    .filter(location => !target || (location.id !== target.id && !location.path.startsWith(`${target.path} - `)))
    .map(location => ({ label: location.path, value: location.id }))
})

const canConfirmDelete = computed(() => {
  if (!deleteTarget.value) return false
  if (deleteMode.value === 'move') return Boolean(deleteTargetLocationId.value)
  return true
})

async function createLocation(parentLocationId: string | null, name: string) {
  const trimmedName = name.trim()
  if (!trimmedName || isCreating.value || isMutating.value) return

  isCreating.value = true
  isMutating.value = true
  try {
    await $fetch('/api/locations', {
      method: 'POST',
      body: { name: trimmedName, parentLocationId }
    })
    newLocationName.value = ''
    await refresh()
    toast.add({ title: 'Location added', color: 'success' })
  } catch (err: unknown) {
    showErrorToast('Failed to add location', err)
  } finally {
    isCreating.value = false
    isMutating.value = false
  }
}

async function renameLocation(locationId: string, name: string) {
  if (isMutating.value) return

  isMutating.value = true
  try {
    await $fetch(`/api/locations/${locationId}/rename`, {
      method: 'PUT',
      body: { name }
    })
    await refresh()
    toast.add({ title: 'Location renamed', color: 'success' })
  } catch (err: unknown) {
    showErrorToast('Failed to rename location', err)
  } finally {
    isMutating.value = false
  }
}

async function moveLocation(locationId: string, parentLocationId: string | null) {
  if (isMutating.value) return

  isMutating.value = true
  try {
    await $fetch(`/api/locations/${locationId}/move`, {
      method: 'PUT',
      body: { parentLocationId }
    })
    await refresh()
    toast.add({ title: 'Location moved', color: 'success' })
  } catch (err: unknown) {
    showErrorToast('Failed to move location', err)
  } finally {
    isMutating.value = false
  }
}

function openDelete(location: BookLocationWithCount) {
  deleteTarget.value = location
  deleteMode.value = location.directBookCount + location.descendantBookCount > 0 ? 'block' : 'clear'
  deleteTargetLocationId.value = undefined
}

async function deleteLocation() {
  if (isMutating.value || !deleteTarget.value || !canConfirmDelete.value) return

  isMutating.value = true
  try {
    await $fetch(`/api/locations/${deleteTarget.value.id}`, {
      method: 'DELETE',
      body: deleteMode.value === 'move'
        ? { mode: 'move', targetLocationId: deleteTargetLocationId.value }
        : { mode: deleteMode.value }
    })
    deleteTarget.value = null
    await refresh()
    toast.add({ title: 'Location deleted', color: 'success' })
  } catch (err: unknown) {
    showErrorToast('Failed to delete location', err)
  } finally {
    isMutating.value = false
  }
}

function showErrorToast(title: string, err: unknown) {
  const message = (err as { data?: { message?: string } })?.data?.message
    ?? (err instanceof Error ? err.message : 'Something went wrong')
  toast.add({ title, description: message, color: 'error' })
}
</script>

<template>
  <UContainer>
    <UPageHeader
      title="Locations"
      :description="locations ? `${locations.length} ${locations.length === 1 ? 'location' : 'locations'}` : undefined"
    >
      <template #links>
        <UButton
          icon="i-lucide-library"
          color="neutral"
          variant="outline"
          to="/library"
        >
          Library
        </UButton>
      </template>
    </UPageHeader>

    <UPageBody>
      <div class="mb-6 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
        <UInput
          v-model="newLocationName"
          icon="i-lucide-map-pin-plus"
          size="lg"
          placeholder="New top-level location"
          @keyup.enter="createLocation(null, newLocationName)"
        />
        <UButton
          icon="i-lucide-plus"
          size="lg"
          :loading="isCreating"
          :disabled="!newLocationName.trim() || isCreating || isMutating"
          @click="createLocation(null, newLocationName)"
        >
          Add Location
        </UButton>
      </div>

      <div
        v-if="status === 'pending'"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <UCard
        v-else-if="locationTree.length === 0"
        class="py-12 text-center"
      >
        <UIcon
          name="i-lucide-map"
          class="mx-auto mb-4 text-6xl text-muted"
        />
        <h2 class="mb-2 text-xl font-semibold">
          No locations yet
        </h2>
        <p class="text-muted">
          Add a shelf, room, box, or any physical place you use to organize books.
        </p>
      </UCard>

      <ul
        v-else
        class="space-y-3"
      >
        <LocationTreeNode
          v-for="node in flattenedLocationTree"
          :key="node.id"
          :node="node"
          :locations="locations ?? []"
          :style="{ marginLeft: `${node.depth * 1.25}rem` }"
          @add="(parentLocationId, name) => createLocation(parentLocationId, name)"
          @rename="renameLocation"
          @move="moveLocation"
          @delete="openDelete"
        />
      </ul>
    </UPageBody>

    <UModal
      :open="Boolean(deleteTarget)"
      title="Delete location"
      :description="deleteTarget ? `Choose what happens to books in ${deleteTarget.path}.` : undefined"
      :ui="{ content: 'sm:max-w-lg', footer: 'justify-end gap-2' }"
      @update:open="value => { if (!value) deleteTarget = null }"
    >
      <template #body>
        <div
          v-if="deleteTarget"
          class="space-y-4"
        >
          <div class="grid grid-cols-3 gap-2 text-sm">
            <div class="rounded-md bg-muted p-3">
              <p class="text-muted">
                Direct
              </p>
              <p class="text-lg font-semibold">
                {{ deleteTarget.directBookCount }}
              </p>
            </div>
            <div class="rounded-md bg-muted p-3">
              <p class="text-muted">
                Nested
              </p>
              <p class="text-lg font-semibold">
                {{ deleteTarget.descendantBookCount }}
              </p>
            </div>
            <div class="rounded-md bg-muted p-3">
              <p class="text-muted">
                Total
              </p>
              <p class="text-lg font-semibold">
                {{ deleteTarget.directBookCount + deleteTarget.descendantBookCount }}
              </p>
            </div>
          </div>

          <URadioGroup
            v-model="deleteMode"
            :items="[
              { label: 'Block if books are assigned', value: 'block' },
              { label: 'Clear location from affected books', value: 'clear' },
              { label: 'Move affected books elsewhere', value: 'move' }
            ]"
          />

          <USelect
            v-if="deleteMode === 'move'"
            v-model="deleteTargetLocationId"
            :items="deleteMoveOptions"
            placeholder="Move books to..."
            class="w-full"
          />
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="soft"
          @click="deleteTarget = null"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          :loading="isMutating"
          :disabled="!canConfirmDelete || isMutating"
          @click="deleteLocation"
        >
          Delete
        </UButton>
      </template>
    </UModal>
  </UContainer>
</template>
