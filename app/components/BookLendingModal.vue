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
const { data: emailCapabilities } = await useEmailCapabilities()

const borrowerDisplayName = ref('')
const borrowerEmail = ref('')
const dueAt = ref('')
const note = ref('')
const isSaving = ref(false)
const inviteUrl = ref('')
const copiedAutomatically = ref(false)
const loanId = ref('')
const deliveryStatus = ref<LoanInviteDeliveryStatus | null>(null)
const isResending = ref(false)
const canEmailInvite = computed(() => Boolean(emailCapabilities.value?.inviteEmailEnabled && borrowerEmail.value.trim()))

const tomorrowDate = computed(() => {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-')
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
    note.value = ''
    inviteUrl.value = ''
    copiedAutomatically.value = false
    loanId.value = ''
    deliveryStatus.value = null
  }
)

async function lendBook() {
  if (!canSave.value) return

  isSaving.value = true
  try {
    const result = await $fetch<{ loan: OwnerLoan, inviteUrl: string, deliveryStatus: LoanInviteDeliveryStatus }>(`/api/books/${props.userBookId}/loans`, {
      method: 'POST',
      body: {
        borrowerDisplayName: borrowerDisplayName.value,
        borrowerEmail: borrowerEmail.value || null,
        dueAt: dueAt.value || null,
        note: note.value || null
      }
    })

    inviteUrl.value = `${window.location.origin}${result.inviteUrl}`
    loanId.value = result.loan.id
    deliveryStatus.value = result.deliveryStatus
    copiedAutomatically.value = await copyInvite({ showToast: false })
    emit('saved', { ...result.loan, inviteUrl: result.inviteUrl })
    toast.add({
      title: 'Book marked as lent out',
      description: result.deliveryStatus === 'sent'
        ? 'An invitation email was sent. The share link is also ready below.'
        : result.deliveryStatus === 'failed'
          ? 'The email could not be sent. The share link is ready below.'
          : copiedAutomatically.value ? 'The share link was copied to your clipboard.' : 'The share link is ready below.',
      color: result.deliveryStatus === 'failed' ? 'warning' : 'success'
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

async function resendEmail() {
  const token = inviteUrl.value ? new URL(inviteUrl.value).pathname.split('/').pop() : null
  if (!loanId.value || !token) return
  isResending.value = true
  try {
    const result = await $fetch<{ deliveryStatus: LoanInviteDeliveryStatus }>(`/api/loans/${loanId.value}/invite-email`, { method: 'POST', body: { token } })
    deliveryStatus.value = result.deliveryStatus
    toast.add({ title: result.deliveryStatus === 'sent' ? 'Invitation email sent' : 'Email is unavailable', color: result.deliveryStatus === 'sent' ? 'success' : 'warning' })
  } catch {
    toast.add({ title: 'Could not resend email', description: 'Your share link remains available below.', color: 'error' })
  } finally {
    isResending.value = false
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
      <div
        class="space-y-4"
        @keydown.meta.enter.prevent="lendBook"
      >
        <UAlert
          v-if="!isSaved"
          color="neutral"
          variant="subtle"
          icon="i-lucide-link"
          title="A share link will be created"
          :description="canEmailInvite ? 'An invitation will be emailed after you save. A private copyable link will also be created.' : 'Email is optional. After you save, Libroo copies a private link you can send however you like.'"
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
          :label="canEmailInvite ? 'Email (invitation will be sent)' : 'Email (optional)'"
          :help="canEmailInvite ? 'Libroo will email this borrower an invitation link.' : 'Only for your private reference.'"
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

        <UFormField
          label="Private note"
          help="Only you can see this note."
        >
          <UTextarea
            v-model="note"
            placeholder="Optional"
            :disabled="isSaved"
            class="w-full"
          />
        </UFormField>

        <UAlert
          v-if="inviteUrl"
          color="neutral"
          variant="subtle"
          icon="i-lucide-link"
          title="Share link copied"
        >
          <template #description>
            <div class="min-w-0 space-y-1">
              <p>Invite URL:</p>
              <button
                type="button"
                class="block w-full min-w-0 text-left"
                @click="() => { void copyInvite() }"
              >
                <code
                  data-testid="loan-invite-url"
                  class="block break-all text-xs leading-relaxed"
                >{{ inviteUrl }}</code>
              </button>
            </div>
          </template>
          <template #actions>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-copy"
              @click="() => { void copyInvite() }"
            >
              Copy link
            </UButton>
            <UButton
              v-if="deliveryStatus === 'failed'"
              color="warning"
              variant="outline"
              icon="i-lucide-send"
              :loading="isResending"
              @click="() => { void resendEmail() }"
            >
              Resend email
            </UButton>
          </template>
        </UAlert>
      </div>
    </template>

    <template #footer>
      <UButton
        color="neutral"
        variant="soft"
        @click="() => { modalOpen = false }"
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
