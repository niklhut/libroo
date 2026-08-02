<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'
import { canShowForgotPasswordAction } from '~~/shared/utils/email-capability-ui'
import { canShowPasskeySignIn } from '~~/shared/utils/auth-capability-ui'
import { authClient } from '~/utils/auth-client'

definePageMeta({
  auth: false
})

usePageTitle('Login')

const route = useRoute()
const authStore = useAuthStore()
const { user, pendingMfa } = storeToRefs(authStore)
const { signIn } = authStore
const toast = useToast()
const { data: emailCapabilities } = await useEmailCapabilities()
const { data: authCapabilities } = await useAuthCapabilities()

const isLoading = ref(false)
const error = ref('')
const showPassword = ref(false)
const showForgotPassword = computed(() => canShowForgotPasswordAction(emailCapabilities.value))
const browserSupportsPasskeys = ref(false)
const showPasskeySignIn = computed(() => browserSupportsPasskeys.value && canShowPasskeySignIn(authCapabilities.value))
const mfaCode = ref('')
const mfaOtp = ref<number[]>([])
const useBackupCode = ref(false)
const isVerifyingMfa = ref(false)
const isPasskeyLoading = ref(false)
const secondFactorCode = computed(() => useBackupCode.value ? mfaCode.value : mfaOtp.value.join(''))

onMounted(() => {
  browserSupportsPasskeys.value = typeof PublicKeyCredential !== 'undefined'
})

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

watch([user, isFromSignout, pendingMfa], ([newUser, signingOut, awaitingMfa]) => {
  // Skip auto-redirect if we just came from sign-out (stale user state may still be present)
  if (signingOut) {
    return
  }

  if (newUser && !awaitingMfa) {
    navigateTo(redirectPath.value)
  }
}, { immediate: true })

type AuthInputField = AuthFormField & {
  id?: string
  placeholder?: string
  autocomplete?: string
  disabled?: boolean
  required?: boolean
  ariaLabel?: string
}

// Form fields
const fields: AuthInputField[] = [
  {
    id: 'login-email',
    name: 'email',
    type: 'email',
    label: 'Email',
    ariaLabel: 'Email',
    placeholder: 'Enter your email',
    required: true
  },
  {
    id: 'login-password',
    name: 'password',
    type: 'password',
    label: 'Password',
    ariaLabel: 'Password',
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

function inputFieldProps(field: AuthFormField) {
  const inputField = field as AuthInputField
  return Object.assign({
    id: inputField.id,
    name: inputField.name,
    placeholder: inputField.placeholder,
    autocomplete: inputField.autocomplete,
    required: inputField.required,
    disabled: inputField.disabled
  }, { 'aria-label': inputField.ariaLabel })
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
    } else if (!pendingMfa.value) {
      isFromSignout.value = false
      await authStore.refresh()
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

async function verifySecondFactor() {
  const code = secondFactorCode.value.trim()
  if (!code) return
  isVerifyingMfa.value = true
  error.value = ''
  try {
    const result = useBackupCode.value
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code })
    if (result.error) {
      error.value = result.error.message || 'Unable to verify the code'
      return
    }
    authStore.clearPendingMfa()
    mfaCode.value = ''
    mfaOtp.value = []
    isFromSignout.value = false
    await authStore.refresh()
    toast.add({ title: 'Welcome back!', description: 'Second factor verified.', color: 'success' })
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause.message : 'Unable to verify the code'
  } finally {
    isVerifyingMfa.value = false
  }
}

async function signInWithPasskey() {
  isPasskeyLoading.value = true
  error.value = ''
  try {
    const result = await authClient.signIn.passkey()
    if (result.error) {
      error.value = result.error.message || 'Passkey sign-in failed'
      return
    }
    const requiresSecondFactor = Boolean((result.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect)
    if (requiresSecondFactor) {
      authStore.beginPendingMfa()
      return
    }
    authStore.clearPendingMfa()
    isFromSignout.value = false
    await authStore.refresh()
  } catch (cause: unknown) {
    error.value = cause instanceof Error ? cause.message : 'Passkey sign-in failed'
  } finally {
    isPasskeyLoading.value = false
  }
}
</script>

<template>
  <UContainer class="py-12 max-w-md">
    <UPageCard v-if="pendingMfa">
      <div class="space-y-5">
        <div class="space-y-1 text-center">
          <UIcon
            name="i-lucide-shield-check"
            class="mx-auto size-8 text-primary"
          />
          <h1 class="text-xl font-semibold">
            Verify your sign-in
          </h1>
          <p class="text-sm text-muted">
            Enter the code from your authenticator app or a recovery code.
          </p>
        </div>
        <UFormField
          v-if="useBackupCode"
          label="Recovery code"
        >
          <UInput
            v-model="mfaCode"
            class="w-full"
            inputmode="text"
            autocomplete="off"
            placeholder="Enter a recovery code"
            @keydown.enter="() => { if (secondFactorCode.trim() && !isVerifyingMfa) verifySecondFactor() }"
          />
        </UFormField>
        <UFormField
          v-else
          label="Authenticator code"
        >
          <div class="flex justify-center">
            <UPinInput
              v-model="mfaOtp"
              :length="6"
              type="number"
              otp
              autofocus
              @complete="() => { if (!isVerifyingMfa) verifySecondFactor() }"
            />
          </div>
        </UFormField>
        <UButton
          block
          :loading="isVerifyingMfa"
          :disabled="!secondFactorCode.trim()"
          @click="verifySecondFactor"
        >
          Verify and sign in
        </UButton>
        <UButton
          color="neutral"
          variant="link"
          block
          @click="() => { useBackupCode = !useBackupCode; mfaCode = ''; mfaOtp = [] }"
        >
          {{ useBackupCode ? 'Use an authenticator code' : 'Use a recovery code instead' }}
        </UButton>
        <UAlert
          v-if="error"
          color="error"
          icon="i-lucide-alert-circle"
          :title="error"
        />
      </div>
    </UPageCard>

    <UPageCard v-else>
      <UAuthForm
        novalidate
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
                @click="() => { showPassword = !showPassword }"
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
          <div class="-mt-3 space-y-4">
            <UButton
              v-if="showPasskeySignIn"
              block
              color="neutral"
              variant="outline"
              icon="i-lucide-fingerprint"
              :loading="isPasskeyLoading"
              @click="signInWithPasskey"
            >
              Sign in with passkey
            </UButton>
            <p class="text-center text-sm text-muted">
              Libroo - Your Library, Managed
            </p>
          </div>
        </template>
      </UAuthForm>
    </UPageCard>
  </UContainer>
</template>
