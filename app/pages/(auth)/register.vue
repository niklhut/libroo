<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'
import type { LegalStatus } from '~~/shared/types/legal'
import type { SignupInvitePreview } from '~~/shared/types/signup-invite'
import { getRegistrationSuccessDescription } from '~~/shared/utils/email-capability-ui'
import { newPasswordSchema } from '~~/shared/utils/password'
import { booleanConfigValue } from '~~/shared/utils/runtime-config'

definePageMeta({
  auth: false,
  authSession: true
})

usePageTitle('Create Account')

const route = useRoute()
const config = useRuntimeConfig()
const authStore = useAuthStore()
const { user } = storeToRefs(authStore)
const { signUp } = authStore
const toast = useToast()
const { data: emailCapabilities } = await useEmailCapabilities()
const { data: legalStatus, error: legalStatusError } = await useFetch<LegalStatus>('/api/legal/status')

const isLoading = ref(false)
const error = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const turnstileToken = ref('')
const turnstile = ref<{ reset: () => void } | null>(null)
const verificationEmail = ref('')
const isVerificationEmailSent = ref(false)
const inviteToken = computed(() => {
  const invite = route.query.invite
  return typeof invite === 'string' && invite.trim() ? invite.trim() : null
})
const registrationEnabled = computed(() => booleanConfigValue(config.public.registrationEnabled, true))
const registrationRequiresInvite = computed(() => !registrationEnabled.value && !inviteToken.value)
const turnstileEnabled = computed(() => booleanConfigValue(config.public.turnstile?.enabled, false))
const turnstileSiteKey = computed(() => typeof config.public.turnstile?.siteKey === 'string' ? config.public.turnstile.siteKey.trim() : '')
const turnstileConfigured = computed(() => turnstileEnabled.value && Boolean(turnstileSiteKey.value))
const turnstileMissingConfig = computed(() => turnstileEnabled.value && !turnstileSiteKey.value)
const privacyPolicyUrl = computed(() => configuredLegalUrl(config.public.legalPrivacyPolicyUrl))
const privacyPolicyLink = computed(() => privacyPolicyUrl.value || '/privacy')
const privacyPolicyLinkExternal = computed(() => Boolean(privacyPolicyUrl.value))
const privacyPolicyConfigured = computed(() => Boolean(privacyPolicyUrl.value || legalStatus.value?.privacy))
const termsUrl = computed(() => configuredLegalUrl(config.public.legalTermsUrl))
const termsLink = computed(() => termsUrl.value || '/terms')
const termsLinkExternal = computed(() => Boolean(termsUrl.value))
const termsConfigured = computed(() => Boolean(termsUrl.value || legalStatus.value?.terms))
const termsStatusUnknown = computed(() => !termsUrl.value && Boolean(legalStatusError.value))
const authFormKey = computed(() => `${inviteEmail.value}:${termsConfigured.value}`)

const { data: invitePreview } = await useAsyncData<SignupInvitePreview | null>(
  'signup-invite-preview',
  () => inviteToken.value
    ? $fetch<SignupInvitePreview>(`/api/signup-invites/${inviteToken.value}`)
    : Promise.resolve(null),
  {
    default: () => null,
    watch: [inviteToken]
  }
)
const inviteEmail = computed(() => invitePreview.value?.email ?? '')
const inviteStatus = computed(() => invitePreview.value?.status ?? null)
const inviteUnavailable = computed(() =>
  !registrationEnabled.value
  && Boolean(inviteToken.value)
  && inviteStatus.value !== 'pending'
)
const inviteBlockTitle = computed(() => {
  if (registrationRequiresInvite.value) return 'Invite required'
  if (inviteStatus.value === 'expired') return 'Invite expired'
  if (inviteStatus.value === 'revoked') return 'Invite revoked'
  if (inviteStatus.value === 'accepted') return 'Invite already used'
  return 'Invite unavailable'
})
const inviteBlockDescription = computed(() => {
  if (registrationRequiresInvite.value) return 'Open the invite link from your administrator to create an account.'
  if (inviteStatus.value === 'expired') return 'This invite link has expired. Ask your administrator for a new invite.'
  if (inviteStatus.value === 'revoked') return 'This invite link has been revoked. Ask your administrator for a new invite.'
  if (inviteStatus.value === 'accepted') return 'This invite link has already been used.'
  return 'This invite link cannot be used. Ask your administrator for a new invite.'
})

const redirectPath = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && /^\/(?!\/)/.test(redirect)) {
    return redirect
  }
  return '/library'
})

// Redirect if already logged in (but not if we just signed out - race condition with stale state)
const isFromSignout = computed(() => route.query.signout === 'true')

watch(user, (newUser) => {
  // Skip auto-redirect if we just came from sign-out (stale user state may still be present)
  if (isFromSignout.value) return

  if (newUser) {
    navigateTo(redirectPath.value)
  }
}, { immediate: true })

// Form fields
const fields = computed<AuthFormField[]>(() => [
  {
    name: 'name',
    type: 'text',
    label: 'Name',
    placeholder: 'Enter your name',
    required: true
  },
  {
    name: 'email',
    type: 'email',
    label: 'Email',
    placeholder: 'Enter your email',
    defaultValue: inviteEmail.value,
    disabled: Boolean(inviteEmail.value),
    required: true
  },
  {
    name: 'password',
    type: 'password',
    label: 'Password',
    placeholder: 'Enter your password',
    hint: 'At least 8 characters',
    required: true
  },
  {
    name: 'confirmPassword',
    type: 'password',
    label: 'Confirm Password',
    placeholder: 'Confirm your password',
    required: true
  },
  ...(termsConfigured.value
    ? [{
        name: 'acceptTerms',
        type: 'checkbox' as const,
        defaultValue: false,
        required: true
      }]
    : [])
])

// Validation schema
const schema = z.object({
  name: z.string({ error: 'Name is required' }).min(1, { error: 'Name is required' }),
  email: z.email({ error: 'Please enter a valid email address' }),
  password: newPasswordSchema(),
  confirmPassword: z.string({ error: 'Confirm Password is required' }).min(1, { error: 'Please confirm your password' }),
  acceptTerms: z.boolean().optional().refine(value => !termsConfigured.value || value === true, {
    error: 'You must agree to the Terms of Service to create an account'
  })
})
  .refine(data => data.password === data.confirmPassword, {
    error: 'Passwords do not match',
    path: ['confirmPassword']
  })

type Schema = z.output<typeof schema>

type AuthInputField = AuthFormField & {
  placeholder?: string
  autocomplete?: string
  disabled?: boolean
}

function inputFieldProps(field: AuthFormField) {
  const inputField = field as AuthInputField
  return {
    name: inputField.name,
    placeholder: inputField.placeholder,
    autocomplete: inputField.autocomplete,
    required: inputField.required,
    disabled: inputField.disabled
  }
}

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  error.value = ''

  if (registrationRequiresInvite.value) {
    error.value = 'An invite is required to create an account'
    return
  }

  if (inviteUnavailable.value) {
    error.value = inviteBlockDescription.value
    return
  }

  if (inviteEmail.value && payload.data.email.toLowerCase() !== inviteEmail.value) {
    error.value = 'Use the email address this invite was sent to'
    return
  }

  if (termsStatusUnknown.value) {
    error.value = 'Unable to verify Terms of Service availability. Please try again.'
    return
  }

  if (termsConfigured.value && !payload.data.acceptTerms) {
    error.value = 'You must agree to the Terms of Service to create an account'
    return
  }

  if (turnstileEnabled.value && !turnstileToken.value) {
    error.value = turnstileMissingConfig.value
      ? 'Bot protection is enabled but the Turnstile site key is not configured.'
      : 'Complete the bot protection check before creating an account.'
    return
  }

  isLoading.value = true

  try {
    const result = await signUp(
      payload.data.email,
      payload.data.password,
      payload.data.name,
      inviteToken.value,
      turnstileToken.value,
      payload.data.acceptTerms
    )

    if (result.error) {
      error.value = result.error.message || 'Failed to create account'
      toast.add({
        title: 'Registration failed',
        description: error.value,
        color: 'error'
      })
    } else {
      verificationEmail.value = payload.data.email
      toast.add({
        title: 'Account created!',
        description: getRegistrationSuccessDescription(emailCapabilities.value),
        color: 'success'
      })

      if (emailCapabilities.value.emailVerificationEnabled) {
        isVerificationEmailSent.value = true
      }
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : 'An unexpected error occurred'
    toast.add({
      title: 'Error',
      description: error.value,
      color: 'error'
    })
  } finally {
    isLoading.value = false
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
      v-if="isVerificationEmailSent"
      title="Verify your email"
      icon="i-lucide-mail-check"
      :description="`We sent a verification link to ${verificationEmail}. Open it to activate your account.`"
      action-label="Go to sign in"
      action-to="/login"
      action-icon="i-lucide-log-in"
    />

    <AuthStateCard
      v-else-if="registrationRequiresInvite || inviteUnavailable"
      :title="inviteBlockTitle"
      :description="inviteBlockDescription"
      icon="i-lucide-lock"
      action-label="Sign in"
      :action-to="{ path: '/login', query: route.query.redirect ? { redirect: route.query.redirect } : undefined }"
      action-icon="i-lucide-log-in"
    />

    <UPageCard v-else>
      <UAuthForm
        :key="authFormKey"
        novalidate
        :schema="schema"
        :fields="fields"
        :loading="isLoading"
        title="Create Account"
        icon="i-lucide-user-plus"
        submit-label="Create Account"
        @submit="onSubmit"
      >
        <template #description>
          Already have an account?
          <ULink
            :to="{ path: '/login', query: route.query.redirect ? { redirect: route.query.redirect } : undefined }"
            class="text-primary font-medium"
          >
            Sign in
          </ULink>
        </template>

        <template #password-field="{ state, field }">
          <UInput
            v-model="state.password"
            v-bind="inputFieldProps(field)"
            :type="showPassword ? 'text' : 'password'"
            class="w-full"
          >
            <template #trailing>
              <UButton
                type="button"
                color="neutral"
                variant="link"
                size="sm"
                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                :aria-pressed="showPassword"
                @click="showPassword = !showPassword"
              />
            </template>
          </UInput>
        </template>

        <template #confirmPassword-field="{ state, field }">
          <UInput
            v-model="state.confirmPassword"
            v-bind="inputFieldProps(field)"
            :type="showConfirmPassword ? 'text' : 'password'"
            class="w-full"
          >
            <template #trailing>
              <UButton
                type="button"
                color="neutral"
                variant="link"
                size="sm"
                :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showConfirmPassword ? 'Hide confirmed password' : 'Show confirmed password'"
                :aria-pressed="showConfirmPassword"
                @click="showConfirmPassword = !showConfirmPassword"
              />
            </template>
          </UInput>
        </template>

        <template #acceptTerms-field="{ state, field }">
          <UCheckbox
            v-model="state.acceptTerms"
            v-bind="inputFieldProps(field)"
          >
            <template #label>
              I agree to the
              <ULink
                :to="termsLink"
                :target="termsLinkExternal ? '_blank' : undefined"
                :rel="termsLinkExternal ? 'noopener noreferrer' : undefined"
                class="text-primary font-medium"
                @click.stop
              >
                Terms of Service
              </ULink>
            </template>
          </UCheckbox>
        </template>

        <template
          #validation
        >
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

          <p
            v-if="privacyPolicyConfigured"
            class="text-center text-sm text-muted"
          >
            By creating an account, you acknowledge that your personal data will be processed as described in the
            <ULink
              :to="privacyPolicyLink"
              :target="privacyPolicyLinkExternal ? '_blank' : undefined"
              :rel="privacyPolicyLinkExternal ? 'noopener noreferrer' : undefined"
              class="text-primary font-medium"
            >
              Privacy Policy
            </ULink>.
          </p>

          <UAlert
            v-if="error"
            color="error"
            icon="i-lucide-alert-circle"
            :title="error"
          />
        </template>
      </UAuthForm>
    </UPageCard>
  </UContainer>
</template>
