<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { storeToRefs } from 'pinia'

const authStore = useAuthStore()
const { user } = storeToRefs(authStore)
const { signOut } = authStore

async function handleSignOut() {
  try {
    await signOut()
  } catch (error) {
    console.error('Failed to sign out', error)
  } finally {
    // Pass signout param so login page skips auto-redirect (race condition with stale user state)
    navigateTo('/login?signout=true')
  }
}

// Logo destination based on auth status
const logoTo = computed(() => user.value ? '/library' : '/login')

// Navigation links - only show Sign Out when logged in
const links = computed<NavigationMenuItem[]>(() => {
  if (user.value) {
    const authenticatedLinks: NavigationMenuItem[] = [
      {
        label: 'Library',
        icon: 'i-lucide-library',
        to: '/library'
      },
      {
        label: 'Loans',
        icon: 'i-lucide-handshake',
        to: '/library/loans'
      },
      {
        label: 'Sign Out',
        icon: 'i-lucide-log-out',
        color: 'neutral' as const,
        variant: 'ghost' as const,
        onClick: handleSignOut
      }
    ]

    if (user.value.role === 'admin') {
      authenticatedLinks.splice(2, 0, {
        label: 'Admin',
        icon: 'i-lucide-shield',
        to: '/admin/users'
      })
    }

    return authenticatedLinks
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
