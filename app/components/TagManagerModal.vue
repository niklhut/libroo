<script setup lang="ts">
import { getAvailableSuggestedTags } from '../utils/tag-manager'

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
  return getAvailableSuggestedTags(allSuggestedTags.value, workingUserTags.value)
})

function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

function initializeState() {
  workingUserTags.value = props.userTags.map(tag => ({ ...tag }))
  allSuggestedTags.value = props.suggestedTags.map(tag => ({ ...tag }))
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

function addSuggestedTag(tag: BookTag) {
  if (workingUserTags.value.some(existing => existing.id === tag.id)) return

  workingUserTags.value.push({ ...tag })
}

function removeUserTag(tag: WorkingTag) {
  workingUserTags.value = workingUserTags.value.filter(item => item.id !== tag.id)
}

function addCustomTag() {
  const raw = customTagInput.value.trim()
  if (!raw) return

  const normalized = normalizeTagName(raw)
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

  workingUserTags.value.push({
    id: `custom:${crypto.randomUUID()}`,
    name: raw,
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

    for (const tagId of idsToDelete) {
      await $fetch(`/api/books/${props.userBookId}/tags/${tagId}`, {
        method: 'DELETE'
      })
    }

    for (const tagId of idsToPromote) {
      await $fetch(`/api/books/${props.userBookId}/tags/${tagId}/promote`, {
        method: 'POST'
      })
    }

    for (const name of customTagsToCreate) {
      await $fetch(`/api/books/${props.userBookId}/tags`, {
        method: 'POST',
        body: { name }
      })
    }

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
              :disabled="!customTagInput.trim()"
              @click="addCustomTag"
            >
              Add
            </UButton>
          </div>
        </div>

        <USeparator />

        <div>
          <h3 class="text-sm font-medium mb-2">
            Preview User Tags
          </h3>
          <div
            v-if="workingUserTags.length > 0"
            class="flex flex-wrap gap-2"
          >
            <div
              v-for="tag in workingUserTags"
              :key="tag.id"
              class="inline-flex items-center gap-1"
            >
              <UBadge
                color="primary"
                variant="subtle"
                size="md"
              >
                {{ tag.name }}
              </UBadge>
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-x"
                @click="removeUserTag(tag)"
              />
            </div>
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
