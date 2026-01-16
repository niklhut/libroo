<script setup lang="ts">
// Root page redirects based on auth status
// - Authenticated users go to /library
// - Unauthenticated users go to /login

definePageMeta({
  auth: false
})

const { isAuthenticated, isPending } = useAuth()

// Watch for auth state to be resolved, then redirect accordingly
watch([isAuthenticated, isPending], ([authenticated, pending]) => {
  if (!pending) {
    navigateTo(authenticated ? '/library' : '/login')
  }
}, { immediate: true })
</script>

<template>
  <div class="min-h-screen flex items-center justify-center">
    <div class="text-center">
      <UIcon
        name="i-lucide-loader-2"
        class="w-8 h-8 animate-spin text-primary"
      />
      <p class="mt-4 text-muted">
        Loading...
      </p>
    </div>
  </div>
</template>
