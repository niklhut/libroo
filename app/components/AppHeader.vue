<script setup lang="ts">
// App header component using Nuxt UI UHeader
const { session, signOut } = useAuth()

async function handleSignOut() {
  await signOut()
  navigateTo('/')
}

// Navigation links
const links = computed(() => {
  if (session.value?.data?.user) {
    return [
      { label: 'My Library', to: '/library' }
    ]
  }
  return []
})
</script>

<template>
  <UHeader
    title="Libroo"
    to="/"
  >
    <template #title>
      <NuxtLink
        to="/"
        class="flex items-center gap-2"
      >
        <UIcon
          name="i-lucide-book-open-check"
          class="text-2xl text-primary"
        />
        <span class="font-bold text-xl">Libroo</span>
      </NuxtLink>
    </template>

    <template #right>
      <UColorModeButton />

      <template v-if="session.data?.user">
        <UButton
          to="/library"
          color="neutral"
          variant="ghost"
        >
          My Library
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-log-out"
          @click="handleSignOut"
        >
          Sign Out
        </UButton>
      </template>

      <template v-else>
        <UButton
          to="/auth/login"
          color="neutral"
          variant="ghost"
        >
          Sign In
        </UButton>
        <UButton
          to="/auth/register"
          color="primary"
        >
          Get Started
        </UButton>
      </template>
    </template>
  </UHeader>
</template>
