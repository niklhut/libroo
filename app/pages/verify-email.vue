<script setup lang="ts">
import { getEmailVerificationFailureStatus } from '~~/shared/utils/email-verification'

definePageMeta({
  auth: false
})

const route = useRoute()
const status = ref<'pending' | 'success' | 'expired' | 'invalid' | 'failure'>('pending')
const message = computed(() => {
  switch (status.value) {
    case 'success':
      return 'Your email address has been verified.'
    case 'expired':
      return 'This verification link has expired. Request a new email from settings.'
    case 'invalid':
      return 'This verification link is invalid or has already been used.'
    case 'failure':
      return 'Unable to verify this email address. Request a new email from settings.'
    default:
      return 'Checking your verification link.'
  }
})

const icon = computed(() => {
  switch (status.value) {
    case 'success':
      return 'i-lucide-shield-check'
    case 'pending':
      return 'i-lucide-loader-circle'
    default:
      return 'i-lucide-triangle-alert'
  }
})

const color = computed(() => {
  switch (status.value) {
    case 'success':
      return 'success'
    case 'pending':
      return 'neutral'
    default:
      return 'error'
  }
})

onMounted(async () => {
  const token = route.query.token
  const error = route.query.error

  if (error === 'TOKEN_EXPIRED') {
    status.value = 'expired'
    return
  }

  if (error) {
    status.value = 'invalid'
    return
  }

  if (typeof token !== 'string' || !token) {
    status.value = 'invalid'
    return
  }

  try {
    const result = await $fetch<{ status: boolean }>('/api/auth/verify-email', {
      query: { token },
      method: 'GET'
    })
    if (result.status !== true) {
      status.value = 'invalid'
      return
    }

    status.value = 'success'
  } catch (err: unknown) {
    status.value = getEmailVerificationFailureStatus(err)
  }
})
</script>

<template>
  <UContainer class="py-12 max-w-lg">
    <UPageCard
      title="Email verification"
      :description="message"
      :icon="icon"
    >
      <UAlert
        :color="color"
        variant="soft"
        :icon="icon"
        :title="status === 'pending' ? 'Verifying email' : status === 'success' ? 'Email verified' : 'Verification failed'"
      />

      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton
            v-if="status === 'success'"
            to="/library"
            icon="i-lucide-library"
          >
            Continue to library
          </UButton>
          <UButton
            v-else
            to="/settings"
            icon="i-lucide-settings"
            color="neutral"
            variant="outline"
          >
            Open settings
          </UButton>
        </div>
      </template>
    </UPageCard>
  </UContainer>
</template>
