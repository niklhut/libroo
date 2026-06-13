<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'
import type { SignupInvitePreview } from '~~/shared/types/signup-invite'

definePageMeta({
  auth: false
})

const route = useRoute()
const config = useRuntimeConfig()
const authStore = useAuthStore()
const { user } = storeToRefs(authStore)
const { signUp } = authStore
const toast = useToast()

const isLoading = ref(false)
const error = ref('')
const verificationEmail = ref('')
const isVerificationEmailSent = ref(false)
const inviteToken = computed(() => {
  const invite = route.query.invite
  return typeof invite === 'string' && invite.trim() ? invite.trim() : null
})
const registrationRequiresInvite = computed(() => !config.public.publicRegistrationEnabled && !inviteToken.value)

const { data: invitePreview } = await useAsyncData<SignupInvitePreview | null>(
  'signup-invite-preview',
  () => inviteToken.value
    ? $fetch<SignupInvitePreview>(`/api/signup-invites/${inviteToken.value}`)
    : Promise.resolve(null),
  {
    default: () => null
  }
)
const inviteEmail = computed(() => invitePreview.value?.email ?? '')

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
  }
])

// Validation schema
const schema = z.object({
  name: z.string({ error: 'Name is required' }).min(1, { error: 'Name is required' }),
  email: z.email({ error: 'Please enter a valid email address' }),
  password: z.string({ error: 'Password is required' }).min(8, { error: 'Password must be at least 8 characters' }),
  confirmPassword: z.string({ error: 'Confirm Password is required' }).min(1, { error: 'Please confirm your password' })
}).refine(data => data.password === data.confirmPassword, {
  error: 'Passwords do not match',
  path: ['confirmPassword']
})

type Schema = z.output<typeof schema>

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  error.value = ''

  if (registrationRequiresInvite.value) {
    error.value = 'An invite is required to create an account'
    return
  }

  isLoading.value = true

  try {
    const result = await signUp(
      payload.data.email,
      payload.data.password,
      payload.data.name,
      inviteToken.value
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
        description: config.public.emailVerificationEnabled
          ? 'Check your email to verify your account before signing in.'
          : 'Welcome to Libroo.',
        color: 'success'
      })

      if (config.public.emailVerificationEnabled) {
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
  }
}
</script>

<template>
  <UContainer class="py-12 max-w-md">
    <UPageCard
      v-if="isVerificationEmailSent"
      title="Verify your email"
      :description="`We sent a verification link to ${verificationEmail}. Open it to activate your account.`"
      icon="i-lucide-mail-check"
    >
      <UAlert
        color="success"
        variant="soft"
        icon="i-lucide-send"
        title="Verification email sent"
      />

      <template #footer>
        <UButton
          to="/login"
          icon="i-lucide-log-in"
        >
          Go to sign in
        </UButton>
      </template>
    </UPageCard>

    <UPageCard
      v-else-if="registrationRequiresInvite"
      title="Invite required"
      description="This Libroo instance only allows invited users to create accounts."
      icon="i-lucide-lock"
    >
      <UAlert
        color="warning"
        variant="subtle"
        icon="i-lucide-lock"
        title="Invite required"
        description="Open the invite link from your administrator to create an account."
      />

      <template #footer>
        <UButton
          :to="{ path: '/login', query: route.query.redirect ? { redirect: route.query.redirect } : undefined }"
          icon="i-lucide-log-in"
        >
          Sign in
        </UButton>
      </template>
    </UPageCard>

    <UPageCard v-else>
      <UAuthForm
        :key="inviteEmail"
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

        <template
          v-if="error"
          #validation
        >
          <UAlert
            color="error"
            icon="i-lucide-alert-circle"
            :title="error"
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
