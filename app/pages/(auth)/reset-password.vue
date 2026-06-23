<script setup lang="ts">
import * as z from 'zod'
import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
import { newPasswordSchema } from '~~/shared/utils/password'

definePageMeta({
  auth: false
})

usePageTitle('Set New Password')

const route = useRoute()
const toast = useToast()
const token = computed(() => {
  const value = route.query.token
  return typeof value === 'string' && value.trim() ? value.trim() : ''
})
const isSubmitting = ref(false)
const isComplete = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)

const fields: AuthFormField[] = [
  {
    name: 'newPassword',
    type: 'password',
    label: 'New password',
    placeholder: 'Enter your new password'
  },
  {
    name: 'confirmPassword',
    type: 'password',
    label: 'Confirm new password',
    placeholder: 'Confirm your new password'
  }
]

const schema = z.object({
  newPassword: newPasswordSchema(),
  confirmPassword: z.string({ error: 'Confirm Password is required' }).min(1, { error: 'Please confirm your password' })
}).refine(data => data.newPassword === data.confirmPassword, {
  error: 'Passwords do not match',
  path: ['confirmPassword']
})

type Schema = z.output<typeof schema>

type AuthInputField = AuthFormField & {
  placeholder?: string
  autocomplete?: string
}

function inputFieldProps(field: AuthFormField) {
  const inputField = field as AuthInputField
  return {
    name: inputField.name,
    placeholder: inputField.placeholder,
    autocomplete: inputField.autocomplete
  }
}

function getFailureMessage(err: unknown, fallback: string) {
  return (err as { data?: { message?: string }, message?: string })?.data?.message
    || (err as { message?: string })?.message
    || fallback
}

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  if (!token.value || isSubmitting.value) return

  isSubmitting.value = true
  try {
    await $fetch('/api/auth/reset-password', {
      method: 'POST',
      body: {
        token: token.value,
        newPassword: payload.data.newPassword
      }
    })
    isComplete.value = true
    toast.add({
      title: 'Password updated',
      description: 'Sign in with your new password.',
      color: 'success'
    })
  } catch (err: unknown) {
    toast.add({
      title: 'Password reset failed',
      description: getFailureMessage(err, 'This reset link is invalid or expired.'),
      color: 'error'
    })
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UContainer class="py-12 max-w-md">
    <AuthStateCard
      v-if="!token"
      title="Set new password"
      description="Open the password reset link from your email."
      icon="i-lucide-circle-alert"
      action-label="Request a reset link"
      action-to="/forgot-password"
      action-icon="i-lucide-send"
    />

    <AuthStateCard
      v-else-if="isComplete"
      title="Password updated"
      description="Sign in with your new password."
      icon="i-lucide-check"
      action-label="Go to sign in"
      action-to="/login"
      action-icon="i-lucide-log-in"
    />

    <UPageCard v-else>
      <UAuthForm
        :schema="schema"
        :fields="fields"
        :loading="isSubmitting"
        title="Set new password"
        icon="i-lucide-key-round"
        submit-label="Update password"
        @submit="onSubmit"
      >
        <template #description>
          Remember your password?
          <ULink
            to="/login"
            class="text-primary font-medium"
          >
            Sign in
          </ULink>
        </template>

        <template #newPassword-label>
          New password <span class="text-error">*</span>
        </template>

        <template #newPassword-field="{ state, field }">
          <UInput
            v-model="state.newPassword"
            v-bind="inputFieldProps(field)"
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
        </template>

        <template #confirmPassword-label>
          Confirm new password <span class="text-error">*</span>
        </template>

        <template #confirmPassword-field="{ state, field }">
          <UInput
            v-model="state.confirmPassword"
            v-bind="inputFieldProps(field)"
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
        </template>

        <template #footer>
          <p class="text-center text-sm text-muted">
            Libroo - Your Library, Managed
          </p>
        </template>
      </UAuthForm>
    </UPageCard>
  </UContainer>
</template>
