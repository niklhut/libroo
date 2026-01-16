<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'

definePageMeta({
  auth: false
})

const route = useRoute()
const { signIn, user } = useAuth()
const toast = useToast()

const isLoading = ref(false)
const error = ref('')

// Get redirect path from query
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

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  error.value = ''
  isLoading.value = true

  try {
    const result = await signIn(payload.data.email, payload.data.password)

    if (result.error) {
      error.value = result.error.message || 'Failed to sign in'
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
      navigateTo(redirectPath.value)
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
            to="/register"
            class="text-primary font-medium"
          >
            Sign up
          </ULink>
        </template>

        <template #password-hint>
          <ULink
            to="#"
            class="text-primary font-medium"
            tabindex="-1"
          >
            Forgot password?
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
