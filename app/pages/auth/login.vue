<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'

definePageMeta({
  auth: false
})

const route = useRoute()
const { signIn, session } = useAuth()
const toast = useToast()

const isLoading = ref(false)
const error = ref('')

// Get redirect path from query
const redirectPath = computed(() => (route.query.redirect as string) || '/library')

// Redirect if already logged in
watch(session, (newSession) => {
  if (newSession.data?.user) {
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
  email: z.email('Please enter a valid email address'),
  password: z.string('Password is required').min(1, 'Password is required')
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
            to="/auth/register"
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
