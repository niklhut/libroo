<script setup lang="ts">
interface Props {
  open: boolean
  userBookId: string
  currentLocation: BookLocation | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'saved': [location: BookLocation | null]
}>()

const toast = useToast()

const selectedLocationId = ref<string>()
const parentLocationId = ref<string>()
const newLocationName = ref('')
const isSavingAssignment = ref(false)
const isCreatingLocation = ref(false)

const modalOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { data: locations, refresh } = await useFetch<BookLocationWithCount[]>('/api/locations', {
  immediate: false,
  watch: false
})

const locationOptions = computed(() =>
  (locations.value ?? []).map(location => ({
    label: location.path,
    value: location.id
  }))
)

const parentOptions = computed(() => [
  { label: 'Top level', value: undefined },
  ...locationOptions.value
])

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    selectedLocationId.value = props.currentLocation?.id
    parentLocationId.value = props.currentLocation?.id
    newLocationName.value = ''
    await refresh()
  }
)

async function createLocation() {
  const name = newLocationName.value.trim()
  if (!name || isCreatingLocation.value) return

  isCreatingLocation.value = true
  try {
    const location = await $fetch<BookLocation>('/api/locations', {
      method: 'POST',
      body: {
        name,
        parentLocationId: parentLocationId.value ?? null
      }
    })

    newLocationName.value = ''
    selectedLocationId.value = location.id
    parentLocationId.value = location.id
    await refresh()
    toast.add({
      title: 'Location added',
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'Unable to add location')
    toast.add({
      title: 'Failed to add location',
      description: message,
      color: 'error'
    })
  } finally {
    isCreatingLocation.value = false
  }
}

async function saveLocation() {
  if (isSavingAssignment.value) return

  isSavingAssignment.value = true
  try {
    const result = await $fetch<{ location: BookLocation | null }>(`/api/books/${props.userBookId}/location`, {
      method: 'PUT',
      body: {
        locationId: selectedLocationId.value ?? null
      }
    })

    emit('saved', result.location)
    modalOpen.value = false
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'Unable to save location')
    toast.add({
      title: 'Failed to save location',
      description: message,
      color: 'error'
    })
  } finally {
    isSavingAssignment.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    title="Manage Location"
    description="Choose where this book lives or add another nested location."
    :ui="{ content: 'sm:max-w-xl', footer: 'justify-end gap-2' }"
  >
    <template #body>
      <div class="space-y-5">
        <UFormField label="Book location">
          <USelect
            v-model="selectedLocationId"
            :items="locationOptions"
            placeholder="No location"
            class="w-full"
          />
        </UFormField>

        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-x"
          @click="selectedLocationId = undefined"
        >
          Clear location
        </UButton>

        <USeparator />

        <div class="space-y-3">
          <UFormField label="Parent location">
            <USelect
              v-model="parentLocationId"
              :items="parentOptions"
              class="w-full"
            />
          </UFormField>
          <div class="flex gap-2">
            <UInput
              v-model="newLocationName"
              placeholder="Shelf B, Section A, Storage Box 4..."
              icon="i-lucide-map-pin-plus"
              class="flex-1"
              @keyup.enter="createLocation"
            />
            <UButton
              icon="i-lucide-plus"
              :loading="isCreatingLocation"
              :disabled="!newLocationName.trim() || isCreatingLocation"
              @click="createLocation"
            >
              Add
            </UButton>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        @click="modalOpen = false"
      >
        Cancel
      </UButton>
      <UButton
        icon="i-lucide-save"
        :loading="isSavingAssignment"
        :disabled="isSavingAssignment"
        @click="saveLocation"
      >
        Save location
      </UButton>
    </template>
  </UModal>
</template>
