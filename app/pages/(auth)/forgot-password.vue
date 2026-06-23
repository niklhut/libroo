<script setup lang="ts">
import * as z from 'zod'
import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
import { booleanConfigValue } from '~~/shared/utils/runtime-config'

definePageMeta({
  auth: false
})

usePageTitle('Reset Password')

const toast = useToast()
const config = useRuntimeConfig()
const { data: emailCapabilities } = await useEmailCapabilities()
const isSubmitting = ref(false)
const requestSent = ref(false)
const turnstileToken = ref('')
const turnstile = ref<{ reset: () => void } | null>(null)
const turnstileEnabled = computed(() => booleanConfigValue(config.public.turnstile?.enabled, false))
const turnstileSiteKey = computed(() => typeof config.public.turnstile?.siteKey === 'string' ? config.public.turnstile.siteKey.trim() : '')
const turnstileConfigured = computed(() => turnstileEnabled.value && Boolean(turnstileSiteKey.value))
const turnstileMissingConfig = computed(() => turnstileEnabled.value && !turnstileSiteKey.value)

const fields: AuthFormField[] = [
  {
    name: 'email',
    type: 'email',
    label: 'Email',
    placeholder: 'Enter your email',
    required: true
  }
]

const schema = z.object({
  email: z.email({ error: 'Please enter a valid email address' })
})

type Schema = z.output<typeof schema>

function getFailureMessage(err: unknown, fallback: string) {
  return (err as { data?: { message?: string }, message?: string })?.data?.message
    || (err as { message?: string })?.message
    || fallback
}

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  if (!emailCapabilities.value.passwordResetEnabled || isSubmitting.value) return

  if (turnstileEnabled.value && !turnstileToken.value) {
    toast.add({
      title: 'Reset unavailable',
      description: turnstileMissingConfig.value
        ? 'Bot protection is enabled but the Turnstile site key is not configured.'
        : 'Complete the bot protection check before requesting a reset email.',
      color: 'error'
    })
    return
  }

  isSubmitting.value = true
  try {
    await $fetch('/api/auth/request-password-reset', {
      method: 'POST',
      headers: turnstileToken.value
        ? {
            'x-captcha-response': turnstileToken.value
          }
        : undefined,
      body: {
        email: payload.data.email,
        redirectTo: '/reset-password'
      }
    })
    requestSent.value = true
    toast.add({
      title: 'Reset email sent',
      description: 'If this email exists in Libroo, a reset link has been sent.',
      color: 'success'
    })
  } catch (err: unknown) {
    toast.add({
      title: 'Reset unavailable',
      description: getFailureMessage(err, 'Unable to send a password reset email.'),
      color: 'error'
    })
  } finally {
    isSubmitting.value = false
    if (turnstileEnabled.value) {
      turnstile.value?.reset()
      turnstileToken.value = ''
    }
  }
}
</script>

<template>
  <UContainer class="py-12 max-w-md">
    <AuthStateCard
      v-if="!emailCapabilities.passwordResetEnabled"
      title="Reset password"
      description="Password reset email is unavailable. Contact your administrator to reset your password."
      icon="i-lucide-mail-x"
      action-label="Back to sign in"
      action-to="/login"
      action-icon="i-lucide-log-in"
    />

    <AuthStateCard
      v-else-if="requestSent"
      title="Reset email sent"
      description="If this email exists in Libroo, a reset link has been sent."
      icon="i-lucide-send"
      action-label="Back to sign in"
      action-to="/login"
      action-icon="i-lucide-log-in"
    />

    <UPageCard v-else>
      <UAuthForm
        novalidate
        :schema="schema"
        :fields="fields"
        :loading="isSubmitting"
        title="Reset password"
        icon="i-lucide-key-round"
        submit-label="Send reset email"
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

        <template #validation>
          <div
            v-if="turnstileConfigured"
            class="flex justify-center"
          >
            <NuxtTurnstile
              ref="turnstile"
              v-model="turnstileToken"
              :site-key="turnstileSiteKey"
              :options="{ size: 'normal' }"
            />
          </div>

          <UAlert
            v-if="turnstileMissingConfig"
            color="warning"
            icon="i-lucide-shield-alert"
            title="Bot protection is not configured"
          />
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
