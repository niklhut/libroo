<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent, AuthFormField } from '@nuxt/ui'

definePageMeta({
  auth: false
})

const { signUp, session } = useAuth()
const toast = useToast()

const isLoading = ref(false)
const error = ref('')

// Redirect if already logged in
watch(session, (newSession) => {
  if (newSession.data?.user) {
    navigateTo('/library')
  }
}, { immediate: true })

// Form fields
const fields: AuthFormField[] = [
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
]

// Validation schema
const schema = z.object({
  name: z.string('Name is required').min(1, 'Name is required'),
  email: z.email('Please enter a valid email address'),
  password: z.string('Password is required').min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string('Confirm Password is required').min(1, 'Please confirm your password')
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword']
})

type Schema = z.output<typeof schema>

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  error.value = ''
  isLoading.value = true

  try {
    const result = await signUp(
      payload.data.email,
      payload.data.password,
      payload.data.name
    )

    if (result.error) {
      error.value = result.error.message || 'Failed to create account'
      toast.add({
        title: 'Registration failed',
        description: error.value,
        color: 'error'
      })
    } else {
      toast.add({
        title: 'Account created!',
        description: 'Welcome to Libroo.',
        color: 'success'
      })
      navigateTo('/library')
    }
  } catch (e: any) {
    error.value = e.message || 'An unexpected error occurred'
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
      <UAuthForm :schema="schema" :fields="fields" :loading="isLoading" title="Create Account" icon="i-lucide-user-plus"
        submit-label="Create Account" @submit="onSubmit">
        <template #description>
          Already have an account?
          <ULink to="/auth/login" class="text-primary font-medium">
            Sign in
          </ULink>
        </template>

        <template v-if="error" #validation>
          <UAlert color="error" icon="i-lucide-alert-circle" :title="error" />
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
