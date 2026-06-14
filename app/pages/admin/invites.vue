<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui/components/Table.vue'
import type { SignupInvite, SignupInviteCreateResult, SignupInviteList } from '~~/shared/types/signup-invite'

const toast = useToast()
const config = useRuntimeConfig()
const route = useRoute()
const router = useRouter()
const requestFetch = useRequestFetch()

if (config.public.publicRegistrationEnabled) {
  await navigateTo('/admin/users', { replace: true })
}

const inviteEmail = ref('')
const inviteExpiresInDays = ref(7)
const isCreatingInvite = ref(false)
const revokingInviteId = ref<string | null>(null)
const createdInviteUrl = ref('')
const createdInviteCopied = ref(false)
const pageSize = 25

const canSendInviteEmail = computed(() => Boolean(config.public.emailDeliveryEnabled))

const currentPage = computed({
  get: () => parsePage(route.query.page),
  set: (page: number) => {
    router.push({
      query: pageQuery(page)
    })
  }
})

const { data: signupInvitesPage, status: invitesStatus, error: invitesError, refresh: refreshInvites } = await useAsyncData<SignupInviteList>(
  'admin-signup-invites',
  () => requestFetch('/api/admin/invites', {
    query: {
      page: currentPage.value,
      pageSize
    }
  }),
  {
    default: () => emptyInvitesPage(currentPage.value),
    watch: [currentPage]
  }
)

const signupInvites = computed(() => signupInvitesPage.value?.invites ?? [])
const totalInvites = computed(() => signupInvitesPage.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalInvites.value / pageSize)))
const pageStart = computed(() => totalInvites.value === 0 ? 0 : ((currentPage.value - 1) * pageSize) + 1)
const pageEnd = computed(() => Math.min(currentPage.value * pageSize, totalInvites.value))
const isLoadingInvites = computed(() => ['idle', 'pending'].includes(invitesStatus.value))
const isInvalidPage = computed(() => !isLoadingInvites.value && currentPage.value > totalPages.value)

if (isInvalidPage.value) {
  await navigateTo({ path: route.path, query: pageQuery(totalPages.value) }, { replace: true })
}

watch(isInvalidPage, (invalid) => {
  if (invalid) {
    router.replace({ query: pageQuery(totalPages.value) })
  }
})

const columns: TableColumn<SignupInvite>[] = [
  { accessorKey: 'email', header: 'Invite' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'createdAt', header: 'Created' },
  { accessorKey: 'expiresAt', header: 'Expires' },
  { accessorKey: 'acceptedAt', header: 'Accepted' },
  { id: 'actions', header: '' }
]

function formatDate(value: string | Date | null) {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value))
}

function inviteStatusColor(inviteStatus: SignupInvite['status']) {
  if (inviteStatus === 'pending') return 'warning'
  if (inviteStatus === 'accepted') return 'success'
  if (inviteStatus === 'revoked') return 'error'
  return 'neutral'
}

function canRevokeInvite(invite: SignupInvite) {
  return invite.status === 'pending'
}

function originalInvite(row: TableRow<SignupInvite>) {
  return row.original
}

async function createInvite() {
  if (isCreatingInvite.value) return

  isCreatingInvite.value = true
  createdInviteUrl.value = ''
  createdInviteCopied.value = false
  try {
    const result = await requestFetch<SignupInviteCreateResult>('/api/admin/invites', {
      method: 'POST',
      body: {
        email: canSendInviteEmail.value ? inviteEmail.value.trim() || undefined : undefined,
        expiresInDays: inviteExpiresInDays.value
      }
    })
    inviteEmail.value = ''
    inviteExpiresInDays.value = 7
    createdInviteUrl.value = result.inviteUrl
    createdInviteCopied.value = result.invite.email ? false : await writeInviteUrlToClipboard(result.inviteUrl)
    if (currentPage.value !== 1) {
      currentPage.value = 1
    }
    await refreshInvites()
    toast.add({
      title: result.invite.email
        ? 'Invite email sent'
        : createdInviteCopied.value ? 'Invite link copied' : 'Invite link created',
      description: result.invite.email || createdInviteCopied.value
        ? undefined
        : 'Copy the link below to share it.',
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'Unable to create invite')
    toast.add({
      title: 'Could not create invite',
      description: message,
      color: 'error'
    })
  } finally {
    isCreatingInvite.value = false
  }
}

async function revokeInvite(invite: SignupInvite) {
  if (revokingInviteId.value || !canRevokeInvite(invite)) return

  revokingInviteId.value = invite.id
  try {
    await requestFetch(`/api/admin/invites/${invite.id}/revoke`, {
      method: 'POST'
    })
    await refreshInvites()
    toast.add({
      title: 'Invite revoked',
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'Unable to revoke invite')
    toast.add({
      title: 'Could not revoke invite',
      description: message,
      color: 'error'
    })
  } finally {
    revokingInviteId.value = null
  }
}

async function copyInviteUrl(url: string) {
  const copied = await writeInviteUrlToClipboard(url)
  createdInviteCopied.value = copied
  toast.add({
    title: copied ? 'Invite link copied' : 'Could not copy link',
    color: copied ? 'success' : 'warning'
  })
}

async function writeInviteUrlToClipboard(url: string) {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(url)
    return true
  } catch {
    return false
  }
}

function emptyInvitesPage(page: number): SignupInviteList {
  return {
    invites: [],
    total: 0,
    page,
    pageSize
  }
}

function parsePage(value: typeof route.query.page) {
  const rawValue = Array.isArray(value) ? value[0] : value
  const page = Number(rawValue ?? 1)
  return Number.isInteger(page) && page > 0 ? page : 1
}

function pageQuery(page: number) {
  return {
    ...route.query,
    page: page > 1 ? String(page) : undefined
  }
}
</script>

<template>
  <UContainer>
    <UPageHeader
      title="Invites"
      description="Create signup links and manage pending invitations."
    />

    <UPageBody>
      <UCard>
        <div class="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
          <div
            class="grid gap-4"
            :class="canSendInviteEmail ? 'sm:grid-cols-[minmax(0,1fr)_9rem]' : 'sm:grid-cols-[9rem]'"
          >
            <UFormField
              v-if="canSendInviteEmail"
              label="Invite email"
              name="inviteEmail"
            >
              <UInput
                v-model="inviteEmail"
                type="email"
                icon="i-lucide-mail"
                placeholder="Optional email address"
              />
            </UFormField>

            <UFormField
              label="Expires after"
              name="inviteExpiresInDays"
              description="Days until the invite expires."
            >
              <UInputNumber
                v-model="inviteExpiresInDays"
                :min="1"
                :max="90"
                :step="1"
                aria-label="Invite expiration in days"
              />
            </UFormField>
          </div>

          <UButton
            :icon="canSendInviteEmail && inviteEmail.trim() ? 'i-lucide-send' : 'i-lucide-link'"
            :loading="isCreatingInvite"
            @click="createInvite"
          >
            {{ canSendInviteEmail && inviteEmail.trim() ? 'Send invite' : 'Create link' }}
          </UButton>
        </div>

        <UAlert
          v-if="!canSendInviteEmail"
          class="mt-4"
          color="neutral"
          variant="subtle"
          icon="i-lucide-mail-x"
          title="Email delivery is not configured"
          description="Invite links can still be created and shared manually."
        />

        <UAlert
          v-if="createdInviteUrl"
          class="mt-4"
          color="success"
          variant="subtle"
          icon="i-lucide-link"
          title="Invite link ready"
        >
          <template #description>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                class="text-left"
                @click="copyInviteUrl(createdInviteUrl)"
              >
                <code class="text-xs break-all">{{ createdInviteUrl }}</code>
              </button>
              <UBadge
                v-if="createdInviteCopied"
                color="success"
                variant="subtle"
              >
                Copied
              </UBadge>
              <UButton
                v-else
                size="xs"
                variant="outline"
                color="neutral"
                icon="i-lucide-copy"
                @click="copyInviteUrl(createdInviteUrl)"
              >
                Copy
              </UButton>
            </div>
          </template>
        </UAlert>
      </UCard>

      <div
        v-if="isLoadingInvites && signupInvites.length === 0"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <UAlert
        v-else-if="invitesError"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Could not load invites"
        :description="invitesError.message"
      />

      <UCard
        v-else-if="signupInvites.length === 0"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-send"
          class="text-6xl text-muted mx-auto mb-4"
        />
        <h2 class="text-xl font-semibold mb-2">
          No invites created yet.
        </h2>
        <p class="text-muted">
          Created signup invites will appear here.
        </p>
      </UCard>

      <template v-else>
        <UTable
          :data="signupInvites"
          :columns="columns"
        >
          <template #email-cell="{ row }">
            <span class="font-medium">{{ originalInvite(row).email || 'Invite link' }}</span>
          </template>

          <template #status-cell="{ row }">
            <UBadge
              :color="inviteStatusColor(originalInvite(row).status)"
              variant="subtle"
            >
              {{ originalInvite(row).status }}
            </UBadge>
          </template>

          <template #createdAt-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatDate(originalInvite(row).createdAt) }}</span>
          </template>

          <template #expiresAt-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatDate(originalInvite(row).expiresAt) }}</span>
          </template>

          <template #acceptedAt-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatDate(originalInvite(row).acceptedAt) }}</span>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex justify-end">
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-ban"
                :disabled="!canRevokeInvite(originalInvite(row))"
                :loading="revokingInviteId === originalInvite(row).id"
                @click="revokeInvite(originalInvite(row))"
              >
                Revoke
              </UButton>
            </div>
          </template>
        </UTable>

        <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-muted">
            Showing {{ pageStart }}-{{ pageEnd }} of {{ totalInvites }} invites
          </p>

          <UPagination
            v-if="totalInvites > pageSize"
            v-model:page="currentPage"
            :total="totalInvites"
            :items-per-page="pageSize"
            show-edges
          />
        </div>
      </template>
    </UPageBody>
  </UContainer>
</template>
