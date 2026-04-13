<script setup lang="ts">
import { getAvailableSuggestedTags } from '../utils/tag-manager'
import { normalizeTagInputText, toSensibleTitleCase } from '../../shared/utils/tag-ingestion'

interface WorkingTag extends BookTag {
  isCustom?: boolean
}

interface Props {
  open: boolean
  userBookId: string
  userTags: BookTag[]
  suggestedTags: BookTag[]
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'saved': []
}>()

const toast = useToast()

const customTagInput = ref('')
const isSaving = ref(false)

const workingUserTags = ref<WorkingTag[]>([])
const allSuggestedTags = ref<BookTag[]>([])
const releasedSuggestedTags = ref<BookTag[]>([])

const modalOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const hasChanges = computed(() => {
  const initialUser = new Set(props.userTags.map(tag => tag.id))
  const currentExistingUser = new Set(
    workingUserTags.value
      .filter(tag => !tag.isCustom)
      .map(tag => tag.id)
  )

  const addedOrRemoved = initialUser.size !== currentExistingUser.size
    || [...initialUser].some(id => !currentExistingUser.has(id))
    || [...currentExistingUser].some(id => !initialUser.has(id))

  const hasCustom = workingUserTags.value.some(tag => tag.isCustom)
  return addedOrRemoved || hasCustom
})

const availableSuggestedTags = computed(() => {
  const uniqueSuggestedById = new Map<string, BookTag>()
  for (const tag of [...allSuggestedTags.value, ...releasedSuggestedTags.value]) {
    if (!uniqueSuggestedById.has(tag.id)) {
      uniqueSuggestedById.set(tag.id, tag)
    }
  }

  return getAvailableSuggestedTags(
    [...uniqueSuggestedById.values()],
    workingUserTags.value
  )
})

const canAddCustomTag = computed(() => {
  return normalizeTagInputText(customTagInput.value).length > 0
})

function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function initializeState() {
  workingUserTags.value = props.userTags.map(tag => ({ ...tag }))
  allSuggestedTags.value = props.suggestedTags.map(tag => ({ ...tag }))
  releasedSuggestedTags.value = []
  customTagInput.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      initializeState()
    }
  }
)

function handleKeydown(e: KeyboardEvent) {
  if (e.metaKey && e.key === 'Enter' && props.open) {
    e.preventDefault()
    if (isSaving.value || !hasChanges.value) return
    saveChanges()
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

function addSuggestedTag(tag: BookTag) {
  if (workingUserTags.value.some(existing => existing.id === tag.id)) return

  workingUserTags.value.push({ ...tag })
}

function removeUserTag(tag: WorkingTag) {
  workingUserTags.value = workingUserTags.value.filter(item => item.id !== tag.id)

  if (!tag.isCustom && !releasedSuggestedTags.value.some(item => item.id === tag.id)) {
    releasedSuggestedTags.value.push({ id: tag.id, name: tag.name })
  }
}

function addCustomTag() {
  const raw = customTagInput.value
  const canonical = normalizeTagInputText(raw)
  if (!canonical) {
    customTagInput.value = ''
    return
  }

  const normalized = normalizeTagName(canonical)
  const alreadyInUserTags = workingUserTags.value.some(tag => normalizeTagName(tag.name) === normalized)
  if (alreadyInUserTags) {
    customTagInput.value = ''
    return
  }

  const fromSuggested = availableSuggestedTags.value.find(tag => normalizeTagName(tag.name) === normalized)
  if (fromSuggested) {
    addSuggestedTag(fromSuggested)
    customTagInput.value = ''
    return
  }

  const displayName = toSensibleTitleCase(canonical)

  workingUserTags.value.push({
    id: `custom:${crypto.randomUUID()}`,
    name: displayName,
    isCustom: true
  })
  customTagInput.value = ''
}

async function saveChanges() {
  if (!hasChanges.value) {
    modalOpen.value = false
    return
  }

  isSaving.value = true

  try {
    const initialUserIds = new Set(props.userTags.map(tag => tag.id))
    const currentExistingUserIds = new Set(
      workingUserTags.value
        .filter(tag => !tag.isCustom)
        .map(tag => tag.id)
    )

    const idsToDelete = [...initialUserIds].filter(id => !currentExistingUserIds.has(id))
    const idsToPromote = [...currentExistingUserIds].filter(id => !initialUserIds.has(id))
    const customTagsToCreate = workingUserTags.value
      .filter(tag => tag.isCustom)
      .map(tag => tag.name)

    await $fetch(`/api/books/${props.userBookId}/tags/batch`, {
      method: 'POST',
      body: {
        deleteIds: idsToDelete,
        promoteIds: idsToPromote,
        createNames: customTagsToCreate
      }
    })

    emit('saved')
    modalOpen.value = false
  } catch (err: unknown) {
    const message = err instanceof Error
      ? err.message
      : (err as { data?: { message?: string } })?.data?.message || 'An error occurred'

    toast.add({
      title: 'Failed to save tags',
      description: message,
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    title="Manage Tags"
    description="Select suggested tags or add custom tags, then save once."
    :ui="{ footer: 'justify-end gap-2' }"
  >
    <template #body>
      <div class="space-y-5">
        <div>
          <h3 class="text-sm font-medium mb-2">
            Suggested Tags
          </h3>
          <div
            v-if="availableSuggestedTags.length > 0"
            class="flex flex-wrap gap-2"
          >
            <UButton
              v-for="tag in availableSuggestedTags"
              :key="tag.id"
              color="neutral"
              variant="soft"
              size="xs"
              @click="addSuggestedTag(tag)"
            >
              {{ tag.name }}
            </UButton>
          </div>
          <p
            v-else
            class="text-sm text-muted"
          >
            No suggested tags available.
          </p>
        </div>

        <USeparator />

        <div>
          <h3 class="text-sm font-medium mb-2">
            Add Custom Tag
          </h3>
          <div class="flex gap-2">
            <UInput
              v-model="customTagInput"
              placeholder="Type a tag name"
              class="flex-1"
              @keyup.enter="addCustomTag"
            />
            <UButton
              icon="i-lucide-plus"
              :disabled="!canAddCustomTag"
              @click="addCustomTag"
            >
              Add
            </UButton>
          </div>
        </div>

        <USeparator />

        <div>
          <h3 class="text-sm font-medium mb-2">
            Selected Tags
          </h3>
          <div
            v-if="workingUserTags.length > 0"
            class="flex flex-wrap gap-2"
          >
            <UButton
              v-for="tag in workingUserTags"
              :key="tag.id"
              color="primary"
              variant="subtle"
              size="xs"
              trailing-icon="i-lucide-x"
              @click="removeUserTag(tag)"
            >
              {{ tag.name }}
            </UButton>
          </div>
          <p
            v-else
            class="text-sm text-muted"
          >
            No user tags selected.
          </p>
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
        :loading="isSaving"
        :disabled="isSaving || !hasChanges"
        @click="saveChanges"
      >
        Save Changes
      </UButton>
    </template>
  </UModal>
</template>
