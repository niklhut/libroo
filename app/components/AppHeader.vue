<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { user, signOut } = useAuth()

async function handleSignOut() {
  await signOut()
  // Pass signout param so login page skips auto-redirect (race condition with stale user state)
  navigateTo('/login?signout=true')
}

// Logo destination based on auth status
const logoTo = computed(() => user.value ? '/library' : '/login')

// Navigation links - only show Sign Out when logged in
const links = computed<NavigationMenuItem[]>(() => {
  if (user.value) {
    return [{
      label: 'Sign Out',
      icon: 'i-lucide-log-out',
      color: 'neutral' as const,
      variant: 'ghost' as const,
      onClick: handleSignOut
    }]
  }
  return []
})
</script>

<template>
  <UHeader :links="links">
    <template #left>
      <NuxtLink
        :to="logoTo"
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
      <UNavigationMenu
        :items="links"
        class="hidden lg:flex"
        variant="link"
      />

      <UColorModeButton />
    </template>
  </UHeader>
</template>
