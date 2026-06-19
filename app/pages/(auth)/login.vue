<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'
import { canShowForgotPasswordAction } from '~~/shared/utils/email-capability-ui'

definePageMeta({
  auth: false
})

usePageTitle('Login')

const route = useRoute()
const authStore = useAuthStore()
const { user } = storeToRefs(authStore)
const { signIn } = authStore
const toast = useToast()
const { data: emailCapabilities } = await useEmailCapabilities()

const isLoading = ref(false)
const error = ref('')
const showPassword = ref(false)
const showForgotPassword = computed(() => canShowForgotPasswordAction(emailCapabilities.value))

// Get redirect path from query
const redirectPath = computed(() => {
  const redirect = route.query.redirect
  if (typeof redirect === 'string' && /^\/(?!\/)/.test(redirect)) {
    return redirect
  }
  return '/library'
})

// Redirect if already logged in (but not if we just signed out - race condition with stale state)
const isFromSignout = ref(route.query.signout === 'true')

watch(user, (newUser) => {
  // Skip auto-redirect if we just came from sign-out (stale user state may still be present)
  if (isFromSignout.value) {
    isFromSignout.value = false
    return
  }

  if (newUser) {
    navigateTo(redirectPath.value)
  }
}, { immediate: true })

// Form fields
const fields: AuthFormField[] = [
  {
    name: 'email',
    type: 'email',
    label: 'Email',
    placeholder: 'Enter your email',
    required: true
  },
  {
    name: 'password',
    type: 'password',
    label: 'Password',
    placeholder: 'Enter your password',
    required: true
  }
]

// Validation schema
const schema = z.object({
  email: z.email({ error: 'Please enter a valid email address' }),
  password: z.string({ error: 'Password is required' }).min(1, { error: 'Password is required' })
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
  isLoading.value = true

  try {
    const result = await signIn(payload.data.email, payload.data.password)

    if (result.error) {
      error.value = result.error.code === 'EMAIL_NOT_VERIFIED'
        ? emailCapabilities.value.emailVerificationEnabled
          ? 'Verify your email address before signing in. A new verification email has been sent.'
          : 'Verify your email address before signing in.'
        : result.error.message || 'Failed to sign in'
      toast.add({
        title: 'Sign in failed',
        description: error.value,
        color: 'error'
      })
    } else {
      toast.add({
        title: 'Welcome back!',
        description: 'You have been signed in successfully.',
        color: 'success'
      })
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
    <UPageCard>
      <UAuthForm
        :schema="schema"
        :fields="fields"
        :loading="isLoading"
        title="Welcome back!"
        icon="i-lucide-library"
        @submit="onSubmit"
      >
        <template #description>
          Don't have an account?
          <ULink
            :to="{ path: '/register', query: route.query.redirect ? { redirect: route.query.redirect } : undefined }"
            class="text-primary font-medium"
          >
            Sign up
          </ULink>
        </template>

        <template #password-hint>
          <ULink
            v-if="showForgotPassword"
            to="/forgot-password"
            class="text-primary font-medium"
          >
            Forgot password?
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
