<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { session, signOut } = useAuth()
const router = useRouter()

async function handleSignOut() {
  await signOut()
  router.push('/')
}

// 1. Define the Navigation Links (Center/Left)
const links = computed<NavigationMenuItem[]>(() => {
  const items = []

  if (session.value?.data?.user) {
    items.push({
      label: 'My Library',
      to: '/library',
      icon: 'i-lucide-book-open'
    })
    items.push({
      label: 'Sign Out',
      icon: 'i-lucide-log-out',
      color: 'neutral' as const,
      variant: 'ghost' as const,
      onClick: handleSignOut
    })
  } else {
    items.push({
      label: 'Sign In',
      to: '/auth/login',
      color: 'neutral' as const,
      variant: 'ghost' as const
    })
  }

  return items
})
</script>

<template>
  <UHeader :links="links">
    <template #left>
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
      <UNavigationMenu
        :items="links"
        class="hidden lg:flex"
        variant="link"
      />

      <UColorModeButton />
    </template>
  </UHeader>
</template>
