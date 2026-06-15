<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import {
  accountEmailChangeSchema,
  accountPasswordChangeSchema,
  type AccountEmailChangeSchema,
  type AccountPasswordChangeSchema
} from '~~/shared/utils/account-settings'
import type { LibraryImportConflictStrategy, LibraryImportResult } from '~~/shared/types/library-transfer'
import { canShowVerificationResendAction, canUseVerifiedEmailChange, getPasswordUpdatedDescription } from '~~/shared/utils/email-capability-ui'
import { authClient } from '~/utils/auth-client'

const toast = useToast()
const route = useRoute()
const authStore = useAuthStore()
const { user } = storeToRefs(authStore)
const { data: emailCapabilities } = await useEmailCapabilities()

const emailState = reactive({
  email: user.value?.email ?? '',
  currentPassword: ''
})
const passwordState = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const isChangingEmail = ref(false)
const isChangingPassword = ref(false)
const isResendingVerification = ref(false)
const pendingEmailChange = ref('')
const showEmailCurrentPassword = ref(false)
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)
const emailForm = useTemplateRef<{ clear: (name?: string | RegExp) => void }>('emailForm')
const passwordForm = useTemplateRef<{ clear: (name?: string | RegExp) => void }>('passwordForm')

const { data: verificationStatus, refresh: refreshVerificationStatus } = await useFetch<{
  enabled: boolean
  email: string
  verified: boolean
  pendingEmail: string | null
}>('/api/auth/verification-status', {
  default: () => ({
    enabled: emailCapabilities.value.emailVerificationEnabled,
    email: user.value?.email ?? '',
    verified: user.value?.emailVerified === true,
    pendingEmail: null
  })
})
const showVerificationResend = computed(() => canShowVerificationResendAction(emailCapabilities.value, verificationStatus.value))

const importFileInput = ref<HTMLInputElement | null>(null)
const importFileName = ref('')
const importCsv = ref('')
const importConflictStrategy = ref<LibraryImportConflictStrategy>('existing')
const importConfirmOpen = ref(false)
const isImporting = ref(false)
const isExporting = ref(false)
const LIBRARY_IMPORT_MAX_BYTES = 10 * 1024 * 1024

const importConflictItems = [
  { label: 'Keep existing data', value: 'existing' },
  { label: 'Use CSV data', value: 'csv' }
]

watch(user, (nextUser) => {
  if (nextUser?.email && !isChangingEmail.value) {
    emailState.email = nextUser.email
  }

  if (nextUser?.email === pendingEmailChange.value) {
    pendingEmailChange.value = ''
  }
})

watch(verificationStatus, (nextStatus) => {
  pendingEmailChange.value = nextStatus.pendingEmail ?? ''
}, { immediate: true })

if (route.query.verify === 'required') {
  toast.add({
    title: 'Verify your email',
    description: emailCapabilities.value.emailVerificationEnabled
      ? 'Open the verification link sent to your email before using the rest of Libroo.'
      : 'Email verification is unavailable. Contact the administrator if your account is blocked.',
    color: 'warning'
  })
}

function getFailureMessage(err: unknown, fallback: string) {
  return (err as { data?: { message?: string }, error?: { message?: string }, message?: string })?.data?.message
    || (err as { error?: { message?: string } })?.error?.message
    || (err as { message?: string })?.message
    || (err instanceof Error ? err.message : undefined)
    || fallback
}

async function changeEmail(payload: FormSubmitEvent<AccountEmailChangeSchema>) {
  isChangingEmail.value = true

  try {
    try {
      await $fetch('/api/auth/verify-password', {
        method: 'POST',
        body: {
          password: payload.data.currentPassword
        }
      })
    } catch {
      toast.add({
        title: 'Email change failed',
        description: 'Current password is incorrect.',
        color: 'error'
      })
      return
    }

    if (canUseVerifiedEmailChange(emailCapabilities.value)) {
      const result = await $fetch<{ pendingEmail: string }>('/api/auth/pending-email-change', {
        method: 'POST',
        body: {
          pendingEmail: payload.data.email,
          currentPassword: payload.data.currentPassword
        }
      })
      pendingEmailChange.value = result.pendingEmail
      emailState.email = verificationStatus.value.email || user.value?.email || emailState.email
      toast.add({
        title: 'Verification email sent',
        description: 'Your current email remains active until the new address is verified.',
        color: 'success'
      })
    } else {
      const result = await authClient.changeEmail({
        newEmail: payload.data.email
      })

      if (result.error) {
        toast.add({
          title: 'Email change failed',
          description: result.error.message || 'Unable to update email',
          color: 'error'
        })
        return
      }

      toast.add({
        title: 'Email updated',
        description: emailCapabilities.value.emailSendingEnabled
          ? undefined
          : 'No verification email was sent because email sending is not configured.',
        color: 'success'
      })
    }

    emailState.currentPassword = ''
    emailForm.value?.clear()
    await refreshVerificationStatus()
  } catch (err: unknown) {
    toast.add({
      title: 'Email change failed',
      description: getFailureMessage(err, 'Unable to update email'),
      color: 'error'
    })
  } finally {
    isChangingEmail.value = false
  }
}

async function resendVerificationEmail() {
  isResendingVerification.value = true

  try {
    await $fetch('/api/auth/resend-verification', {
      method: 'POST'
    })
    await refreshVerificationStatus()
    toast.add({
      title: 'Verification email sent',
      description: `Check ${verificationStatus.value.pendingEmail || verificationStatus.value.email || user.value?.email}.`,
      color: 'success'
    })
  } catch (err: unknown) {
    toast.add({
      title: 'Verification failed',
      description: getFailureMessage(err, 'Unable to send verification email'),
      color: 'error'
    })
  } finally {
    isResendingVerification.value = false
  }
}

async function changePassword(payload: FormSubmitEvent<AccountPasswordChangeSchema>) {
  isChangingPassword.value = true

  try {
    const result = await authClient.changePassword({
      currentPassword: payload.data.currentPassword,
      newPassword: payload.data.newPassword,
      revokeOtherSessions: true
    })

    if (result.error) {
      toast.add({
        title: 'Password change failed',
        description: result.error.message || 'Unable to update password',
        color: 'error'
      })
      return
    }

    passwordState.currentPassword = ''
    passwordState.newPassword = ''
    passwordState.confirmPassword = ''
    passwordForm.value?.clear()
    toast.add({
      title: 'Password updated',
      description: getPasswordUpdatedDescription(emailCapabilities.value),
      color: 'success'
    })
  } catch (err: unknown) {
    toast.add({
      title: 'Password change failed',
      description: getFailureMessage(err, 'Unable to update password'),
      color: 'error'
    })
  } finally {
    isChangingPassword.value = false
  }
}

async function downloadLibraryCsv() {
  if (!import.meta.client) return

  isExporting.value = true
  try {
    const csv = await $fetch<string>('/api/library/export', { responseType: 'text' })
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `libroo-library-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  } catch (err: unknown) {
    toast.add({
      title: 'Export failed',
      description: getFailureMessage(err, 'Unable to export your library'),
      color: 'error'
    })
  } finally {
    isExporting.value = false
  }
}

function resetImport() {
  importFileName.value = ''
  importCsv.value = ''
  importConflictStrategy.value = 'existing'
  if (importFileInput.value) {
    importFileInput.value.value = ''
  }
}

async function handleImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (file.size > LIBRARY_IMPORT_MAX_BYTES) {
    resetImport()
    toast.add({
      title: 'CSV file is too large',
      description: 'Choose a CSV file under 10 MB.',
      color: 'warning'
    })
    return
  }

  importFileName.value = file.name
  importCsv.value = await file.text()
}

function openImportConfirmation() {
  if (!importCsv.value || isImporting.value) return
  importConfirmOpen.value = true
}

async function importLibraryCsvFile() {
  if (!importCsv.value || isImporting.value) return

  isImporting.value = true
  try {
    const result = await $fetch<LibraryImportResult>('/api/library/import', {
      method: 'POST',
      body: {
        csv: importCsv.value,
        conflictStrategy: importConflictStrategy.value
      }
    })

    importConfirmOpen.value = false
    resetImport()

    toast.add({
      title: 'Import complete',
      description: `${result.created} created, ${result.updated} updated, ${result.skipped} skipped${result.failed.length ? `, ${result.failed.length} failed` : ''}.`,
      color: result.failed.length ? 'warning' : 'success'
    })
  } catch (err: unknown) {
    toast.add({
      title: 'Import failed',
      description: getFailureMessage(err, 'Unable to import your library'),
      color: 'error'
    })
  } finally {
    isImporting.value = false
  }
}
</script>

<template>
  <UContainer>
    <UPageHeader
      title="Settings"
      description="Manage your account and library data."
    />

    <UPageBody>
      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-user"
                class="text-lg"
              />
              <span class="font-semibold">Account</span>
            </div>
          </template>

          <div
            v-if="emailCapabilities.emailVerificationEnabled && verificationStatus.enabled"
            class="mb-5 space-y-3"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="space-y-1">
                <p class="text-sm font-medium">
                  Email verification
                </p>
                <p class="text-sm text-muted">
                  {{ verificationStatus.verified ? 'Your current email address is verified.' : 'Verify your email address before using the rest of Libroo.' }}
                </p>
              </div>
              <UBadge
                :color="verificationStatus.verified ? 'success' : 'warning'"
                variant="soft"
                :icon="verificationStatus.verified ? 'i-lucide-shield-check' : 'i-lucide-mail-warning'"
              >
                {{ verificationStatus.verified ? 'Verified' : 'Unverified' }}
              </UBadge>
            </div>

            <UAlert
              v-if="pendingEmailChange"
              color="info"
              variant="soft"
              icon="i-lucide-mail-check"
              title="Pending email change"
              :description="`Open the verification link sent to ${pendingEmailChange}. Your account email stays ${user?.email} until then. Enter a different email below to replace this pending change.`"
            />

            <UButton
              v-if="showVerificationResend"
              type="button"
              icon="i-lucide-send"
              color="neutral"
              variant="outline"
              :loading="isResendingVerification"
              :disabled="isResendingVerification"
              @click="resendVerificationEmail"
            >
              Resend verification email
            </UButton>
          </div>

          <UForm
            ref="emailForm"
            :schema="accountEmailChangeSchema"
            :state="emailState"
            class="space-y-4"
            @submit="changeEmail"
          >
            <UFormField
              label="Email"
              name="email"
              required
            >
              <UInput
                v-model="emailState.email"
                type="email"
                class="w-full"
                autocomplete="email"
              />
            </UFormField>
            <UFormField
              label="Current password"
              name="currentPassword"
              required
            >
              <UInput
                v-model="emailState.currentPassword"
                :type="showEmailCurrentPassword ? 'text' : 'password'"
                class="w-full"
                autocomplete="current-password"
              >
                <template #trailing>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :icon="showEmailCurrentPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    :aria-label="showEmailCurrentPassword ? 'Hide current password' : 'Show current password'"
                    @click="showEmailCurrentPassword = !showEmailCurrentPassword"
                  />
                </template>
              </UInput>
            </UFormField>

            <UButton
              type="submit"
              icon="i-lucide-mail"
              :loading="isChangingEmail"
              :disabled="isChangingEmail || emailState.email === user?.email || !emailState.currentPassword"
            >
              Change email
            </UButton>
          </UForm>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-lock-keyhole"
                class="text-lg"
              />
              <span class="font-semibold">Security</span>
            </div>
          </template>

          <UForm
            ref="passwordForm"
            :schema="accountPasswordChangeSchema"
            :state="passwordState"
            class="space-y-4"
            @submit="changePassword"
          >
            <UFormField
              label="Current password"
              name="currentPassword"
              required
            >
              <UInput
                v-model="passwordState.currentPassword"
                :type="showCurrentPassword ? 'text' : 'password'"
                class="w-full"
                autocomplete="current-password"
              >
                <template #trailing>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :icon="showCurrentPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    :aria-label="showCurrentPassword ? 'Hide current password' : 'Show current password'"
                    @click="showCurrentPassword = !showCurrentPassword"
                  />
                </template>
              </UInput>
            </UFormField>
            <UFormField
              label="New password"
              name="newPassword"
              required
            >
              <UInput
                v-model="passwordState.newPassword"
                :type="showNewPassword ? 'text' : 'password'"
                class="w-full"
                autocomplete="new-password"
              >
                <template #trailing>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :icon="showNewPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    :aria-label="showNewPassword ? 'Hide new password' : 'Show new password'"
                    @click="showNewPassword = !showNewPassword"
                  />
                </template>
              </UInput>
            </UFormField>
            <UFormField
              label="Confirm new password"
              name="confirmPassword"
              required
            >
              <UInput
                v-model="passwordState.confirmPassword"
                :type="showConfirmPassword ? 'text' : 'password'"
                class="w-full"
                autocomplete="new-password"
              >
                <template #trailing>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    :aria-label="showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'"
                    @click="showConfirmPassword = !showConfirmPassword"
                  />
                </template>
              </UInput>
            </UFormField>

            <UButton
              type="submit"
              icon="i-lucide-key-round"
              :loading="isChangingPassword"
              :disabled="isChangingPassword"
            >
              Change password
            </UButton>
          </UForm>
        </UCard>
      </div>

      <UCard class="mt-6">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-database"
              class="text-lg"
            />
            <span class="font-semibold">Library data</span>
          </div>
        </template>

        <div class="grid gap-6 lg:grid-cols-2">
          <div class="space-y-4">
            <div>
              <h2 class="text-base font-semibold">
                Export
              </h2>
              <p class="mt-1 text-sm text-muted">
                Download a CSV backup of your books, tags, locations, reading state, and active loans.
              </p>
            </div>

            <UButton
              icon="i-lucide-download"
              color="neutral"
              variant="outline"
              :loading="isExporting"
              :disabled="isExporting"
              @click="downloadLibraryCsv"
            >
              Export CSV
            </UButton>
          </div>

          <div class="space-y-4">
            <div>
              <h2 class="text-base font-semibold">
                Import
              </h2>
              <p class="mt-1 text-sm text-muted">
                Restore books from a Libroo CSV export.
              </p>
            </div>

            <input
              ref="importFileInput"
              type="file"
              accept=".csv,text/csv"
              class="hidden"
              @change="handleImportFileChange"
            >
            <div class="flex flex-wrap items-center gap-3">
              <UButton
                icon="i-lucide-file-up"
                color="neutral"
                variant="outline"
                @click="importFileInput?.click()"
              >
                {{ importFileName || 'Choose CSV' }}
              </UButton>
              <UButton
                v-if="importCsv"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                :disabled="isImporting"
                @click="resetImport"
              >
                Clear
              </UButton>
            </div>

            <URadioGroup
              v-model="importConflictStrategy"
              :items="importConflictItems"
              legend="When a book already exists"
            />

            <UButton
              icon="i-lucide-upload"
              :disabled="!importCsv || isImporting"
              :loading="isImporting"
              @click="openImportConfirmation"
            >
              Import CSV
            </UButton>
          </div>
        </div>
      </UCard>

      <UModal
        v-model:open="importConfirmOpen"
        title="Import library CSV?"
        description="This will update your library using the selected conflict strategy."
        :ui="{ footer: 'justify-end gap-3' }"
      >
        <template #body>
          <div class="space-y-3 text-sm">
            <p>
              File: <span class="font-medium">{{ importFileName }}</span>
            </p>
            <p>
              Existing books:
              <span class="font-medium">
                {{ importConflictStrategy === 'existing' ? 'keep existing data' : 'use CSV data' }}
              </span>
            </p>
          </div>
        </template>

        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            :disabled="isImporting"
            @click="importConfirmOpen = false"
          >
            Cancel
          </UButton>
          <UButton
            icon="i-lucide-upload"
            :loading="isImporting"
            :disabled="isImporting"
            @click="importLibraryCsvFile"
          >
            Confirm import
          </UButton>
        </template>
      </UModal>
    </UPageBody>
  </UContainer>
</template>
