<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import QRCode from 'qrcode'
import {
  ACCOUNT_DELETION_CONFIRMATION_TEXT,
  accountDeletionSchema,
  accountEmailChangeSchema,
  accountPasswordChangeSchema,
  type AccountDeletionSchema,
  type AccountEmailChangeSchema,
  type AccountPasswordChangeSchema
} from '~~/shared/utils/account-settings'
import type { LibraryImportConflictStrategy, LibraryImportResult } from '~~/shared/types/library-transfer'
import { roleIncludesAdmin } from '~~/shared/utils/auth-roles'
import { canShowVerificationResendAction, canUseVerifiedEmailChange, getPasswordUpdatedDescription } from '~~/shared/utils/email-capability-ui'
import { canShowPasskeyManagement, canShowTwoFactorManagement } from '~~/shared/utils/auth-capability-ui'
import { authClient } from '~/utils/auth-client'

usePageTitle('Settings')

const toast = useToast()
const route = useRoute()
const authStore = useAuthStore()
const { user } = storeToRefs(authStore)
const { data: emailCapabilities } = await useEmailCapabilities()
const { data: authCapabilities } = await useAuthCapabilities()

const emailState = reactive({
  email: user.value?.email ?? '',
  currentPassword: ''
})
const passwordState = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const deletionState = reactive({
  currentPassword: '',
  confirmation: ''
})
const twoFactorState = reactive({ password: '', code: '' })
const passkeyState = reactive({ password: '', name: '' })
const totpUri = ref('')
const totpQrCode = ref('')
const backupCodes = ref<string[]>([])
const twoFactorEnabled = ref(Boolean(user.value?.twoFactorEnabled))
const twoFactorSetupOpen = ref(false)
const twoFactorSetupStep = ref<'password' | 'backup-codes' | 'verify'>('password')
const backupCodesCopied = ref(false)
const isEnablingTwoFactor = ref(false)
const isVerifyingTotp = ref(false)
const isDisablingTwoFactor = ref(false)
const isRegeneratingBackupCodes = ref(false)
const isAddingPasskey = ref(false)
const isRemovingPasskey = ref<string | null>(null)
const passkeys = ref<Array<{ id: string, name?: string | null, createdAt?: string | Date | null, aaguid?: string | null }>>([])
const passkeyManagementOpen = ref(false)
const emailManagementOpen = ref(false)
const passwordManagementOpen = ref(false)
const twoFactorManagementOpen = ref(false)
const libraryImportOpen = ref(false)
const showTwoFactorPassword = ref(false)
const showPasskeyPassword = ref(false)
const showPasskeyManagement = computed(() => canShowPasskeyManagement(authCapabilities.value))
const showTwoFactorManagement = computed(() => canShowTwoFactorManagement(authCapabilities.value))

const isChangingEmail = ref(false)
const isChangingPassword = ref(false)
const isDeletingAccount = ref(false)
const accountDeletionOpen = ref(false)
const isResendingVerification = ref(false)
const pendingEmailChange = ref('')
const showEmailCurrentPassword = ref(false)
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)
const emailForm = useTemplateRef<{ clear: (name?: string | RegExp) => void }>('emailForm')
const passwordForm = useTemplateRef<{ clear: (name?: string | RegExp) => void }>('passwordForm')
const deletionForm = useTemplateRef<{ clear: (name?: string | RegExp) => void }>('deletionForm')

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
const currentUserIsAdmin = computed(() => roleIncludesAdmin(user.value?.role))

const importFileInput = ref<HTMLInputElement | null>(null)
const importFileName = ref('')
const importCsv = ref('')
const importConflictStrategy = ref<LibraryImportConflictStrategy>('existing')
const importEnrich = ref(false)
const importConfirmOpen = ref(false)
const isImporting = ref(false)
const isExporting = ref(false)
const LIBRARY_IMPORT_MAX_BYTES = 10 * 1024 * 1024

const importConflictItems = [
  { label: 'Keep existing data', value: 'existing' },
  { label: 'Use CSV data', value: 'csv' }
]

watch(user, (nextUser, previousUser) => {
  // A session refresh can complete after a user starts editing this form. Only
  // mirror the store when the input still reflects the previously known email.
  if (nextUser?.email && !isChangingEmail.value && emailState.email === (previousUser?.email ?? '')) {
    emailState.email = nextUser.email
  }

  if (nextUser?.email === pendingEmailChange.value) {
    pendingEmailChange.value = ''
  }
})

watch(verificationStatus, (nextStatus) => {
  pendingEmailChange.value = nextStatus.pendingEmail ?? ''
}, { immediate: true })

watch(accountDeletionOpen, (isOpen) => {
  if (isOpen) return
  resetAccountDeletionForm()
})

watch(libraryImportOpen, (isOpen) => {
  if (!isOpen) resetImport()
})

onMounted(() => {
  void refreshPasskeys()
})

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

function resetAccountDeletionForm() {
  deletionState.currentPassword = ''
  deletionState.confirmation = ''
  deletionForm.value?.clear()
}

function openEmailManagement() {
  emailState.email = user.value?.email ?? ''
  emailState.currentPassword = ''
  emailForm.value?.clear()
  emailManagementOpen.value = true
}

function openPasswordManagement() {
  passwordState.currentPassword = ''
  passwordState.newPassword = ''
  passwordState.confirmPassword = ''
  passwordForm.value?.clear()
  passwordManagementOpen.value = true
}

function openTwoFactorManagement() {
  twoFactorState.password = ''
  backupCodes.value = []
  backupCodesCopied.value = false
  twoFactorManagementOpen.value = true
}

function openLibraryImport() {
  resetImport()
  libraryImportOpen.value = true
}

async function verifyRecentPassword(password: string) {
  if (!password) throw new Error('Enter your current password to continue.')
  await $fetch('/api/auth/verify-password', { method: 'POST', body: { password } })
}

async function enableTwoFactor() {
  isEnablingTwoFactor.value = true
  try {
    await verifyRecentPassword(twoFactorState.password)
    const result = await authClient.twoFactor.enable({ password: twoFactorState.password })
    if (result.error || !result.data) throw new Error(result.error?.message || 'Unable to start two-factor setup')
    totpUri.value = result.data.totpURI
    backupCodes.value = result.data.backupCodes
    totpQrCode.value = await QRCode.toDataURL(result.data.totpURI, { margin: 1, width: 220 })
    twoFactorState.code = ''
    backupCodesCopied.value = false
    twoFactorSetupStep.value = 'backup-codes'
  } catch (err: unknown) {
    toast.add({ title: 'Two-factor setup failed', description: getFailureMessage(err, 'Unable to start two-factor setup'), color: 'error' })
  } finally {
    isEnablingTwoFactor.value = false
  }
}

async function verifyTwoFactorSetup() {
  isVerifyingTotp.value = true
  try {
    const result = await authClient.twoFactor.verifyTotp({ code: twoFactorState.code.trim() })
    if (result.error) throw new Error(result.error.message || 'Invalid authenticator code')
    twoFactorEnabled.value = true
    twoFactorState.password = ''
    twoFactorState.code = ''
    twoFactorSetupOpen.value = false
    twoFactorSetupStep.value = 'password'
    await authStore.refresh()
    toast.add({ title: 'Two-factor authentication enabled', description: 'Store your recovery codes somewhere safe.', color: 'success' })
  } catch (err: unknown) {
    toast.add({ title: 'Verification failed', description: getFailureMessage(err, 'Unable to verify the authenticator code'), color: 'error' })
  } finally {
    isVerifyingTotp.value = false
  }
}

function openTwoFactorSetup() {
  twoFactorState.password = ''
  twoFactorState.code = ''
  totpUri.value = ''
  totpQrCode.value = ''
  backupCodes.value = []
  backupCodesCopied.value = false
  twoFactorSetupStep.value = 'password'
  twoFactorSetupOpen.value = true
}

async function copyBackupCodes() {
  const copied = await copyToClipboard(backupCodes.value.join('\n'))
  if (copied) {
    backupCodesCopied.value = true
    toast.add({ title: 'Recovery codes copied', color: 'success' })
    return
  }

  toast.add({ title: 'Could not copy recovery codes', description: 'Select and copy the codes manually before continuing.', color: 'warning' })
}

async function copyTotpUri() {
  const copied = await copyToClipboard(totpUri.value)
  toast.add({
    title: copied ? 'Authenticator URI copied' : 'Could not copy authenticator URI',
    description: copied ? undefined : 'Select and copy the URI manually.',
    color: copied ? 'success' : 'warning'
  })
}

async function copyToClipboard(value: string) {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

async function disableTwoFactor() {
  isDisablingTwoFactor.value = true
  try {
    await verifyRecentPassword(twoFactorState.password)
    const result = await authClient.twoFactor.disable({ password: twoFactorState.password })
    if (result.error) throw new Error(result.error.message || 'Unable to disable two-factor authentication')
    twoFactorEnabled.value = false
    totpUri.value = ''
    totpQrCode.value = ''
    backupCodes.value = []
    twoFactorState.password = ''
    twoFactorManagementOpen.value = false
    await authStore.refresh()
    toast.add({ title: 'Two-factor authentication disabled', color: 'success' })
  } catch (err: unknown) {
    toast.add({ title: 'Unable to disable two-factor authentication', description: getFailureMessage(err, 'Unable to disable two-factor authentication'), color: 'error' })
  } finally {
    isDisablingTwoFactor.value = false
  }
}

async function regenerateBackupCodes() {
  isRegeneratingBackupCodes.value = true
  try {
    await verifyRecentPassword(twoFactorState.password)
    const result = await authClient.twoFactor.generateBackupCodes({ password: twoFactorState.password })
    if (result.error || !result.data) throw new Error(result.error?.message || 'Unable to regenerate recovery codes')
    backupCodes.value = result.data.backupCodes
    twoFactorState.password = ''
    toast.add({ title: 'Recovery codes regenerated', description: 'All previous recovery codes are now invalid.', color: 'success' })
  } catch (err: unknown) {
    toast.add({ title: 'Unable to regenerate recovery codes', description: getFailureMessage(err, 'Unable to regenerate recovery codes'), color: 'error' })
  } finally {
    isRegeneratingBackupCodes.value = false
  }
}

async function refreshPasskeys() {
  if (!import.meta.client || !showPasskeyManagement.value) return
  try {
    const result = await authClient.passkey.listUserPasskeys()
    if (result.error) throw new Error(result.error.message || 'Unable to load passkeys')
    passkeys.value = result.data ?? []
  } catch (err: unknown) {
    toast.add({ title: 'Unable to load passkeys', description: getFailureMessage(err, 'Try again shortly.'), color: 'error' })
  }
}

async function openPasskeyManagement() {
  passkeyState.password = ''
  passkeyState.name = ''
  passkeyManagementOpen.value = true
  await refreshPasskeys()
}

async function addPasskey() {
  isAddingPasskey.value = true
  try {
    await verifyRecentPassword(passkeyState.password)
    const result = await authClient.passkey.addPasskey({ name: passkeyState.name.trim() || undefined })
    if (result.error) throw new Error(result.error.message || 'Unable to add passkey')
    passkeyState.name = ''
    passkeyState.password = ''
    await refreshPasskeys()
    toast.add({ title: 'Passkey added', color: 'success' })
  } catch (err: unknown) {
    toast.add({ title: 'Unable to add passkey', description: getFailureMessage(err, 'Unable to add passkey'), color: 'error' })
  } finally {
    isAddingPasskey.value = false
  }
}

async function removePasskey(id: string) {
  isRemovingPasskey.value = id
  try {
    await verifyRecentPassword(passkeyState.password)
    const result = await authClient.passkey.deletePasskey({ id })
    if (result.error) throw new Error(result.error.message || 'Unable to remove passkey')
    await refreshPasskeys()
    toast.add({ title: 'Passkey removed', color: 'success' })
  } catch (err: unknown) {
    toast.add({ title: 'Unable to remove passkey', description: getFailureMessage(err, 'Unable to remove passkey'), color: 'error' })
  } finally {
    isRemovingPasskey.value = null
  }
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
    passwordManagementOpen.value = false
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

async function deleteAccount(payload: FormSubmitEvent<AccountDeletionSchema>) {
  isDeletingAccount.value = true

  try {
    await $fetch('/api/account/delete', {
      method: 'POST',
      body: payload.data
    })

    accountDeletionOpen.value = false
    resetAccountDeletionForm()
    toast.add({
      title: 'Account deleted',
      description: 'Your Libroo account and personal library data were deleted.',
      color: 'success'
    })
    await navigateTo('/login')
  } catch (err: unknown) {
    toast.add({
      title: 'Account deletion failed',
      description: getFailureMessage(err, 'Unable to delete your account'),
      color: 'error'
    })
  } finally {
    isDeletingAccount.value = false
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
  importEnrich.value = false
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
        conflictStrategy: importConflictStrategy.value,
        enrich: importEnrich.value
      }
    })

    importConfirmOpen.value = false
    libraryImportOpen.value = false
    resetImport()

    toast.add({
      title: 'Import complete',
      description: `${result.created} created, ${result.updated} updated, ${result.skipped} skipped${result.enrichmentQueued ? `, ${result.enrichmentQueued} queued for missing covers and details` : ''}${result.failed.length ? `, ${result.failed.length} failed` : ''}.`,
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
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon
              name="i-lucide-user-round"
              class="text-lg"
            />
            <span class="font-semibold">Account & sign-in</span>
          </div>
        </template>

        <div class="divide-y divide-default">
          <div class="flex flex-col gap-4 py-5 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-start gap-3">
              <UIcon
                name="i-lucide-mail"
                class="mt-0.5 size-5 shrink-0 text-muted"
              />
              <div class="min-w-0">
                <p class="font-medium">
                  Email
                </p>
                <p class="truncate text-sm text-muted">
                  {{ pendingEmailChange
                    ? `Changing to ${pendingEmailChange} — verification pending`
                    : emailCapabilities.emailVerificationEnabled && verificationStatus.enabled
                      ? `${user?.email || 'Email'} · ${verificationStatus.verified ? 'verified' : 'unverified'}`
                      : user?.email }}
                </p>
              </div>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              @click="openEmailManagement"
            >
              Manage
            </UButton>
          </div>

          <div class="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-start gap-3">
              <UIcon
                name="i-lucide-key-round"
                class="mt-0.5 size-5 shrink-0 text-muted"
              />
              <div>
                <p class="font-medium">
                  Password
                </p>
                <p class="text-sm text-muted">
                  Configured
                </p>
              </div>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              @click="openPasswordManagement"
            >
              Change password
            </UButton>
          </div>

          <div
            v-if="showTwoFactorManagement"
            class="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex min-w-0 items-start gap-3">
              <UIcon
                name="i-lucide-shield-check"
                class="mt-0.5 size-5 shrink-0 text-muted"
              />
              <div>
                <p class="font-medium">
                  Two-factor authentication
                </p>
                <p class="text-sm text-muted">
                  {{ twoFactorEnabled ? 'Enabled with an authenticator app' : 'Not configured' }}
                </p>
              </div>
            </div>
            <UButton
              :icon="twoFactorEnabled ? undefined : 'i-lucide-shield-plus'"
              color="neutral"
              variant="outline"
              @click="twoFactorEnabled ? openTwoFactorManagement() : openTwoFactorSetup()"
            >
              {{ twoFactorEnabled ? 'Manage' : 'Set up' }}
            </UButton>
          </div>

          <div
            v-if="showPasskeyManagement"
            class="flex flex-col gap-4 py-5 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div class="flex min-w-0 items-start gap-3">
              <UIcon
                name="i-lucide-fingerprint"
                class="mt-0.5 size-5 shrink-0 text-muted"
              />
              <div>
                <p class="font-medium">
                  Passkeys
                </p>
                <p class="text-sm text-muted">
                  {{ passkeys.length ? `${passkeys.length} ${passkeys.length === 1 ? 'passkey' : 'passkeys'} configured` : 'No passkeys configured' }}
                </p>
              </div>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              @click="openPasskeyManagement"
            >
              {{ passkeys.length ? 'Manage' : 'Add passkey' }}
            </UButton>
          </div>

          <div class="flex flex-col gap-4 py-5 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 items-start gap-3 text-error">
              <UIcon
                name="i-lucide-trash-2"
                class="mt-0.5 size-5 shrink-0"
              />
              <div>
                <p class="font-medium">
                  Delete account
                </p>
                <p class="text-sm text-muted">
                  Permanently remove your account and personal library data.
                </p>
              </div>
            </div>
            <UButton
              color="error"
              variant="subtle"
              icon="i-lucide-trash-2"
              @click="() => { accountDeletionOpen = true }"
            >
              Delete account
            </UButton>
          </div>
        </div>
      </UCard>

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

        <div class="divide-y divide-default">
          <div class="flex flex-col gap-4 py-5 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-start gap-3">
              <UIcon
                name="i-lucide-download"
                class="mt-0.5 size-5 shrink-0 text-muted"
              />
              <div>
                <p class="font-medium">
                  Export library
                </p>
                <p class="text-sm text-muted">
                  Download your books, tags, locations, reading state, and active loans as CSV.
                </p>
              </div>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              :loading="isExporting"
              :disabled="isExporting"
              @click="downloadLibraryCsv"
            >
              Export CSV
            </UButton>
          </div>

          <div class="flex flex-col gap-4 py-5 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex items-start gap-3">
              <UIcon
                name="i-lucide-file-up"
                class="mt-0.5 size-5 shrink-0 text-muted"
              />
              <div>
                <p class="font-medium">
                  Import library
                </p>
                <p class="text-sm text-muted">
                  Restore books from a Libroo CSV export.
                </p>
              </div>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              @click="openLibraryImport"
            >
              Import CSV
            </UButton>
          </div>
        </div>
      </UCard>

      <UModal
        v-model:open="emailManagementOpen"
        title="Manage email"
        description="Changing your email requires your current password."
      >
        <template #body>
          <div class="space-y-5">
            <div
              v-if="emailCapabilities.emailVerificationEnabled && verificationStatus.enabled"
              class="space-y-3"
            >
              <UAlert
                :color="verificationStatus.verified ? 'success' : 'warning'"
                variant="soft"
                :icon="verificationStatus.verified ? 'i-lucide-shield-check' : 'i-lucide-mail-warning'"
                :title="verificationStatus.verified ? 'Email verified' : 'Email verification required'"
                :description="verificationStatus.verified ? 'Your current email address is verified.' : 'Verify your email address before using the rest of Libroo.'"
              />
              <UAlert
                v-if="pendingEmailChange"
                color="info"
                variant="soft"
                icon="i-lucide-mail-check"
                title="Pending email change"
                :description="`Open the verification link sent to ${pendingEmailChange}. Your account email stays ${user?.email} until then.`"
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
                      @click="() => { showEmailCurrentPassword = !showEmailCurrentPassword }"
                    />
                  </template>
                </UInput>
              </UFormField>
              <div class="flex justify-end gap-3">
                <UButton
                  type="button"
                  color="neutral"
                  variant="soft"
                  :disabled="isChangingEmail"
                  @click="() => { emailManagementOpen = false }"
                >
                  Cancel
                </UButton>
                <UButton
                  type="submit"
                  icon="i-lucide-mail"
                  :loading="isChangingEmail"
                  :disabled="isChangingEmail || emailState.email === user?.email || !emailState.currentPassword"
                >
                  Change email
                </UButton>
              </div>
            </UForm>
          </div>
        </template>
      </UModal>

      <UModal
        v-model:open="passwordManagementOpen"
        title="Change password"
        description="This signs out your other active sessions."
      >
        <template #body>
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
                    @click="() => { showCurrentPassword = !showCurrentPassword }"
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
                    @click="() => { showNewPassword = !showNewPassword }"
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
                    @click="() => { showConfirmPassword = !showConfirmPassword }"
                  />
                </template>
              </UInput>
            </UFormField>
            <div class="flex justify-end gap-3">
              <UButton
                type="button"
                color="neutral"
                variant="soft"
                :disabled="isChangingPassword"
                @click="() => { passwordManagementOpen = false }"
              >
                Cancel
              </UButton>
              <UButton
                type="submit"
                icon="i-lucide-key-round"
                :loading="isChangingPassword"
                :disabled="isChangingPassword"
              >
                Change password
              </UButton>
            </div>
          </UForm>
        </template>
      </UModal>

      <UModal
        v-model:open="libraryImportOpen"
        title="Import library CSV"
        description="Restore a Libroo CSV export into your library."
      >
        <template #body>
          <div class="space-y-5">
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
            <UCheckbox
              v-model="importEnrich"
              label="Find missing covers and book details"
              description="After import, valid ISBNs can fill blank descriptions, publication details, and covers. Existing values are never replaced."
            />
          </div>
        </template>
        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            :disabled="isImporting"
            @click="() => { libraryImportOpen = false }"
          >
            Cancel
          </UButton>
          <UButton
            icon="i-lucide-upload"
            :disabled="!importCsv || isImporting"
            :loading="isImporting"
            @click="openImportConfirmation"
          >
            Import CSV
          </UButton>
        </template>
      </UModal>

      <UModal
        v-model:open="twoFactorManagementOpen"
        title="Manage two-factor authentication"
        description="Recovery-code changes and disabling two-factor authentication require your current password."
      >
        <template #body>
          <div class="space-y-5">
            <UAlert
              color="success"
              icon="i-lucide-shield-check"
              title="Two-factor authentication is enabled"
            />
            <UFormField
              label="Current password"
              required
            >
              <UInput
                v-model="twoFactorState.password"
                :type="showTwoFactorPassword ? 'text' : 'password'"
                autocomplete="current-password"
                class="w-full"
              >
                <template #trailing>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :icon="showTwoFactorPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    @click="() => { showTwoFactorPassword = !showTwoFactorPassword }"
                  />
                </template>
              </UInput>
            </UFormField>
            <div class="flex flex-wrap gap-3">
              <UButton
                color="neutral"
                variant="outline"
                :loading="isRegeneratingBackupCodes"
                :disabled="!twoFactorState.password"
                @click="regenerateBackupCodes"
              >
                Regenerate recovery codes
              </UButton>
              <UButton
                color="error"
                variant="soft"
                :loading="isDisablingTwoFactor"
                :disabled="!twoFactorState.password"
                @click="disableTwoFactor"
              >
                Disable two-factor authentication
              </UButton>
            </div>
            <p class="text-xs text-muted">
              Regenerating recovery codes permanently invalidates all previous codes.
            </p>
            <template v-if="backupCodes.length">
              <UAlert
                color="warning"
                icon="i-lucide-key-round"
                title="Save your new recovery codes"
                description="Each code works once. They are shown only now."
              />
              <div class="grid grid-cols-2 gap-2 rounded-lg border border-warning/40 bg-warning/5 p-4 font-mono text-sm">
                <code
                  v-for="code in backupCodes"
                  :key="code"
                  class="rounded bg-default px-2 py-1"
                >{{ code }}</code>
              </div>
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-copy"
                @click="copyBackupCodes"
              >
                Copy all recovery codes
              </UButton>
            </template>
          </div>
        </template>
        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            @click="() => { twoFactorManagementOpen = false }"
          >
            Done
          </UButton>
        </template>
      </UModal>

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
            <p>
              Open Library:
              <span class="font-medium">
                {{ !importEnrich
                  ? 'do not look up missing information'
                  : importConflictStrategy === 'existing'
                    ? 'look up only newly created imports; matched library books are skipped'
                    : 'look up new and previously CSV-imported books without replacing stored values' }}
              </span>
            </p>
          </div>
        </template>

        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            :disabled="isImporting"
            @click="() => { importConfirmOpen = false }"
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

      <UModal
        v-model:open="accountDeletionOpen"
        title="Delete your account?"
        description="This action is immediate and cannot be undone."
        :ui="{ footer: 'justify-end gap-3' }"
      >
        <template #body>
          <UForm
            ref="deletionForm"
            :schema="accountDeletionSchema"
            :state="deletionState"
            class="space-y-4"
            @submit="deleteAccount"
          >
            <UAlert
              color="error"
              variant="soft"
              icon="i-lucide-triangle-alert"
              title="What will be deleted"
              description="Your account, active sessions, personal library records, tags, notes, ratings, locations, reading state, loans, invites, settings, and uploaded cover images will be removed."
            />

            <UAlert
              color="neutral"
              variant="soft"
              icon="i-lucide-database"
              title="What may remain"
              description="Information that belongs to other people, or shared book information that no longer identifies you, may remain. Deleted information may also stay temporarily in protected backups."
            />

            <UAlert
              v-if="currentUserIsAdmin"
              color="warning"
              variant="soft"
              icon="i-lucide-shield-alert"
              title="Last-admin protection"
              description="The last active admin cannot delete their own account until another active admin exists."
            />

            <UFormField
              label="Current password"
              name="currentPassword"
              required
            >
              <UInput
                v-model="deletionState.currentPassword"
                type="password"
                class="w-full"
                autocomplete="current-password"
              />
            </UFormField>

            <UFormField
              :label="`Type ${ACCOUNT_DELETION_CONFIRMATION_TEXT}`"
              name="confirmation"
              required
            >
              <UInput
                v-model="deletionState.confirmation"
                class="w-full"
                autocomplete="off"
              />
            </UFormField>

            <div class="flex justify-end gap-3">
              <UButton
                type="button"
                color="neutral"
                variant="soft"
                :disabled="isDeletingAccount"
                @click="() => { accountDeletionOpen = false }"
              >
                Cancel
              </UButton>
              <UButton
                type="submit"
                color="error"
                icon="i-lucide-trash-2"
                :loading="isDeletingAccount"
                :disabled="isDeletingAccount || deletionState.confirmation !== ACCOUNT_DELETION_CONFIRMATION_TEXT || !deletionState.currentPassword"
              >
                Delete permanently
              </UButton>
            </div>
          </UForm>
        </template>
      </UModal>

      <UModal
        v-model:open="twoFactorSetupOpen"
        title="Set up two-factor authentication"
        :description="twoFactorSetupStep === 'password'
          ? 'Confirm your password to create a new authenticator setup.'
          : twoFactorSetupStep === 'backup-codes'
            ? 'Save your recovery codes before continuing. They are shown only now.'
            : 'Scan the QR code or add the authenticator URI, then enter its first code.'"
        :ui="{ footer: 'justify-end gap-3' }"
      >
        <template #body>
          <div class="space-y-5">
            <div class="flex items-center gap-2 text-sm text-muted">
              <UBadge :color="twoFactorSetupStep === 'password' ? 'primary' : 'neutral'">
                1. Confirm
              </UBadge>
              <UBadge :color="twoFactorSetupStep === 'backup-codes' ? 'primary' : 'neutral'">
                2. Save codes
              </UBadge>
              <UBadge :color="twoFactorSetupStep === 'verify' ? 'primary' : 'neutral'">
                3. Verify
              </UBadge>
            </div>

            <template v-if="twoFactorSetupStep === 'password'">
              <UFormField
                label="Current password"
                required
              >
                <UInput
                  v-model="twoFactorState.password"
                  :type="showTwoFactorPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  class="w-full"
                >
                  <template #trailing>
                    <UButton
                      type="button"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      :icon="showTwoFactorPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                      @click="() => { showTwoFactorPassword = !showTwoFactorPassword }"
                    />
                  </template>
                </UInput>
              </UFormField>
            </template>

            <template v-else-if="twoFactorSetupStep === 'backup-codes'">
              <UAlert
                color="warning"
                icon="i-lucide-key-round"
                title="Save your recovery codes"
                description="Each code works once. Regenerating recovery codes invalidates every previous code."
              />
              <div class="grid grid-cols-2 gap-2 rounded-lg border border-warning/40 bg-warning/5 p-4 font-mono text-sm">
                <code
                  v-for="code in backupCodes"
                  :key="code"
                  class="rounded bg-default px-2 py-1"
                >{{ code }}</code>
              </div>
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-copy"
                @click="copyBackupCodes"
              >
                Copy all recovery codes
              </UButton>
            </template>

            <template v-else>
              <img
                v-if="totpQrCode"
                :src="totpQrCode"
                alt="TOTP enrollment QR code"
                class="mx-auto size-52 rounded border border-default bg-white p-2"
              >
              <UFormField label="Authenticator URI">
                <UTextarea
                  :model-value="totpUri"
                  readonly
                  :rows="3"
                  class="w-full"
                />
              </UFormField>
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-copy"
                @click="copyTotpUri"
              >
                Copy authenticator URI
              </UButton>
              <UFormField label="First authenticator code">
                <UInput
                  v-model="twoFactorState.code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="123456"
                  class="w-full"
                />
              </UFormField>
            </template>
          </div>
        </template>

        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            :disabled="isEnablingTwoFactor || isVerifyingTotp"
            @click="() => { twoFactorSetupOpen = false }"
          >
            Cancel
          </UButton>
          <UButton
            v-if="twoFactorSetupStep === 'password'"
            :loading="isEnablingTwoFactor"
            :disabled="!twoFactorState.password"
            @click="enableTwoFactor"
          >
            Continue
          </UButton>
          <UButton
            v-else-if="twoFactorSetupStep === 'backup-codes'"
            :icon="backupCodesCopied ? 'i-lucide-check' : undefined"
            @click="() => { twoFactorSetupStep = 'verify' }"
          >
            I've saved these codes
          </UButton>
          <UButton
            v-else
            :loading="isVerifyingTotp"
            :disabled="!twoFactorState.code.trim()"
            @click="verifyTwoFactorSetup"
          >
            Verify and finish
          </UButton>
        </template>
      </UModal>

      <UModal
        v-model:open="passkeyManagementOpen"
        title="Manage passkeys"
        description="Add, name, or remove passkeys for this account. Confirm your current password before making a change."
        :ui="{ footer: 'justify-end gap-3' }"
      >
        <template #body>
          <div class="space-y-5">
            <UFormField
              label="Current password"
              required
            >
              <UInput
                v-model="passkeyState.password"
                :type="showPasskeyPassword ? 'text' : 'password'"
                autocomplete="current-password"
                class="w-full"
              >
                <template #trailing>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :icon="showPasskeyPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    @click="() => { showPasskeyPassword = !showPasskeyPassword }"
                  />
                </template>
              </UInput>
            </UFormField>
            <div class="flex flex-wrap items-end gap-3">
              <UFormField
                label="Passkey name"
                class="min-w-52 flex-1"
              >
                <UInput
                  v-model="passkeyState.name"
                  placeholder="e.g. Work laptop"
                  class="w-full"
                />
              </UFormField>
              <UButton
                icon="i-lucide-fingerprint"
                :loading="isAddingPasskey"
                :disabled="!passkeyState.password"
                @click="addPasskey"
              >
                Add passkey
              </UButton>
            </div>
            <div
              v-if="passkeys.length"
              class="divide-y divide-default rounded-lg border border-default"
            >
              <div
                v-for="item in passkeys"
                :key="item.id"
                class="flex items-center justify-between gap-3 p-3"
              >
                <div>
                  <p class="font-medium">
                    {{ item.name || 'Passkey' }}
                  </p>
                  <p
                    v-if="item.createdAt"
                    class="text-xs text-muted"
                  >
                    Added {{ new Date(item.createdAt).toLocaleDateString() }}
                  </p>
                </div>
                <UButton
                  color="error"
                  variant="ghost"
                  size="sm"
                  :loading="isRemovingPasskey === item.id"
                  :disabled="!passkeyState.password"
                  @click="removePasskey(item.id)"
                >
                  Remove
                </UButton>
              </div>
            </div>
            <p
              v-else
              class="text-sm text-muted"
            >
              No passkeys have been added yet.
            </p>
          </div>
        </template>

        <template #footer>
          <UButton
            color="neutral"
            variant="soft"
            @click="() => { passkeyManagementOpen = false }"
          >
            Done
          </UButton>
        </template>
      </UModal>
    </UPageBody>
  </UContainer>
</template>
