<script setup lang="ts">
import { getEmailVerificationFailureStatus } from '~~/shared/utils/email-verification'

definePageMeta({
  auth: false
})

usePageTitle('Email Verification')

const route = useRoute()
const authStore = useAuthStore()
const { isAuthenticated } = storeToRefs(authStore)
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

const actionLabel = computed(() => {
  if (status.value === 'pending') return ''
  if (status.value === 'success') {
    return isAuthenticated.value ? 'Go to your library' : 'Go to sign in'
  }
  return 'Open settings'
})
const actionTo = computed(() => {
  if (status.value === 'pending') return undefined
  if (status.value === 'success') {
    return isAuthenticated.value ? '/library' : '/login'
  }
  return '/settings'
})
const actionIcon = computed(() => {
  if (status.value === 'pending') return undefined
  if (status.value === 'success') {
    return isAuthenticated.value ? 'i-lucide-library' : 'i-lucide-log-in'
  }
  return 'i-lucide-settings'
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

    try {
      await authStore.refresh()
    } catch {
      // Verification already succeeded; fall back to the current auth state.
    }
    status.value = 'success'
  } catch (err: unknown) {
    status.value = getEmailVerificationFailureStatus(err)
  }
})
</script>

<template>
  <UContainer class="py-12 max-w-md">
    <AuthStateCard
      title="Email verification"
      :description="message"
      :icon="icon"
      :action-label="actionLabel"
      :action-to="actionTo"
      :action-icon="actionIcon"
    />
  </UContainer>
</template>
