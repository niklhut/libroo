<script setup lang="ts">
import { ref } from 'vue'

definePageMeta({
  layout: false
})

const { signIn, session } = useAuth()

const email = ref('')
const password = ref('')
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
  isLoading.value = true

  try {
    const result = await signIn(email.value, password.value)

    if (result.error) {
      error.value = result.error.message || 'Failed to sign in'
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
            Sign In
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

          <UFormField label="Password" name="password" required>
            <UInput
              v-model="password"
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
            Sign In
          </UButton>
        </form>

        <template #footer>
          <p class="text-center text-sm text-gray-600 dark:text-gray-400">
            Don't have an account?
            <NuxtLink to="/auth/register" class="text-primary-500 hover:text-primary-600 font-medium">
              Sign up
            </NuxtLink>
          </p>
        </template>
      </UCard>
    </div>
  </div>
</template>
