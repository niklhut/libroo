<script setup lang="ts">
interface Props {
  open: boolean
  userBookId: string
  saving?: boolean
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'saved': [loan: OwnerLoan]
}>()

const toast = useToast()

const borrowerDisplayName = ref('')
const borrowerEmail = ref('')
const dueAt = ref('')
const isSaving = ref(false)
const inviteUrl = ref('')
const copiedAutomatically = ref(false)

const tomorrowDate = computed(() => {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
})

const modalOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const isSaved = computed(() => Boolean(inviteUrl.value))
const canSave = computed(() => borrowerDisplayName.value.trim().length > 0 && !isSaving.value && !isSaved.value)

watch(
  () => props.open,
  (open) => {
    if (!open) return
    borrowerDisplayName.value = ''
    borrowerEmail.value = ''
    dueAt.value = ''
    inviteUrl.value = ''
    copiedAutomatically.value = false
  }
)

async function lendBook() {
  if (!canSave.value) return

  isSaving.value = true
  try {
    const result = await $fetch<{ loan: OwnerLoan, inviteUrl: string }>(`/api/books/${props.userBookId}/loans`, {
      method: 'POST',
      body: {
        borrowerDisplayName: borrowerDisplayName.value,
        borrowerEmail: borrowerEmail.value || null,
        dueAt: dueAt.value || null
      }
    })

    inviteUrl.value = `${window.location.origin}${result.inviteUrl}`
    copiedAutomatically.value = await copyInvite({ showToast: false })
    emit('saved', { ...result.loan, inviteUrl: result.inviteUrl })
    toast.add({
      title: 'Book marked as lent out',
      description: copiedAutomatically.value
        ? 'The share link was copied to your clipboard.'
        : 'The share link is ready below.',
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'Unable to lend this book')
    toast.add({
      title: 'Could not lend book',
      description: message,
      color: 'error'
    })
  } finally {
    isSaving.value = false
  }
}

async function copyInvite(options: { showToast?: boolean } = {}) {
  if (!inviteUrl.value) return false

  try {
    await navigator.clipboard.writeText(inviteUrl.value)
    if (options.showToast !== false) {
      toast.add({
        title: 'Invite link copied',
        color: 'success'
      })
    }
    return true
  } catch {
    if (options.showToast !== false) {
      toast.add({
        title: 'Could not copy link',
        description: 'The share link is ready below.',
        color: 'warning'
      })
    }
    return false
  }
}
</script>

<template>
  <UModal
    v-model:open="modalOpen"
    title="Record a book loan"
    description="Save who has this book."
    :ui="{ content: 'sm:max-w-xl', footer: 'justify-end gap-2' }"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="!isSaved"
          color="neutral"
          variant="subtle"
          icon="i-lucide-link"
          title="A share link will be created"
          description="Email is optional. After you save, Libroo copies a private link you can send however you like."
        />

        <UFormField
          label="Borrower name"
          required
        >
          <UInput
            v-model="borrowerDisplayName"
            placeholder="Who has the book?"
            icon="i-lucide-user"
            class="w-full"
            :disabled="isSaved"
          />
        </UFormField>

        <UFormField
          label="Email (optional)"
          help="Only for your private reference."
        >
          <UInput
            v-model="borrowerEmail"
            type="email"
            placeholder="Optional"
            icon="i-lucide-mail"
            class="w-full"
            :disabled="isSaved"
          />
        </UFormField>

        <UFormField label="Due date">
          <UInput
            v-model="dueAt"
            type="date"
            icon="i-lucide-calendar"
            :min="tomorrowDate"
            class="w-full"
            :disabled="isSaved"
          />
        </UFormField>

        <UAlert
          v-if="inviteUrl"
          color="neutral"
          variant="subtle"
          icon="i-lucide-link"
          title="Share link copied"
          :description="copiedAutomatically ? 'Send the copied link so they can add this book to borrowed books.' : 'They can use this link to add the book to borrowed books.'"
        >
          <template #actions>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-copy"
              @click="copyInvite()"
            >
              Copy link
            </UButton>
          </template>
        </UAlert>
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        @click="modalOpen = false"
      >
        Close
      </UButton>
      <UButton
        v-if="!isSaved"
        icon="i-lucide-handshake"
        :loading="isSaving"
        :disabled="!canSave"
        @click="lendBook"
      >
        Save loan
      </UButton>
    </template>
  </UModal>
</template>
