<script setup lang="ts">
import { ref } from 'vue'

definePageMeta({
  layout: false
})

const { signUp, session } = useAuth()

const name = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const isLoading = ref(false)
const error = ref('')

// Redirect if already logged in
watch(session, (newSession) => {
  if (newSession.data?.user) {
    navigateTo('/library')
  }
}, { immediate: true })

async function handleSubmit() {
  error.value = ''

  // Validate passwords match
  if (password.value !== confirmPassword.value) {
    error.value = 'Passwords do not match'
    return
  }

  // Validate password length
  if (password.value.length < 8) {
    error.value = 'Password must be at least 8 characters'
    return
  }

  isLoading.value = true

  try {
    const result = await signUp(email.value, password.value, name.value)

    if (result.error) {
      error.value = result.error.message || 'Failed to create account'
    } else {
      navigateTo('/library')
    }
  } catch (e: any) {
    error.value = e.message || 'An unexpected error occurred'
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
    <div class="max-w-md w-full space-y-8">
      <div class="text-center">
        <h1 class="text-4xl font-bold text-gray-900 dark:text-white">
          Libroo
        </h1>
        <p class="mt-2 text-gray-600 dark:text-gray-400">
          Your Library, Managed
        </p>
      </div>

      <UCard class="mt-8">
        <template #header>
          <h2 class="text-xl font-semibold text-center">
            Create Account
          </h2>
        </template>

        <form class="space-y-4" @submit.prevent="handleSubmit">
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            :title="error"
            icon="i-lucide-alert-circle"
          />

          <UFormField label="Name" name="name" required>
            <UInput
              v-model="name"
              type="text"
              placeholder="Your name"
              icon="i-lucide-user"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Email" name="email" required>
            <UInput
              v-model="email"
              type="email"
              placeholder="you@example.com"
              icon="i-lucide-mail"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Password" name="password" required hint="At least 8 characters">
            <UInput
              v-model="password"
              type="password"
              placeholder="••••••••"
              icon="i-lucide-lock"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Confirm Password" name="confirmPassword" required>
            <UInput
              v-model="confirmPassword"
              type="password"
              placeholder="••••••••"
              icon="i-lucide-lock"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UButton
            type="submit"
            block
            size="lg"
            :loading="isLoading"
          >
            Create Account
          </UButton>
        </form>

        <template #footer>
          <p class="text-center text-sm text-gray-600 dark:text-gray-400">
            Already have an account?
            <NuxtLink to="/auth/login" class="text-primary-500 hover:text-primary-600 font-medium">
              Sign in
            </NuxtLink>
          </p>
        </template>
      </UCard>
    </div>
  </div>
</template>
