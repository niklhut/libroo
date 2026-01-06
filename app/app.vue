<script setup>
const { session, signOut } = useAuth()

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = 'Libroo - Your Library, Managed'
const description = 'A private, physical-first library management system. Track what you own, who borrowed it, and where it is.'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  twitterCard: 'summary_large_image'
})

async function handleSignOut() {
  await signOut()
  navigateTo('/auth/login')
}
</script>

<template>
  <UApp>
    <UHeader>
      <template #left>
        <NuxtLink to="/" class="flex items-center gap-2">
          <UIcon name="i-lucide-library" class="text-2xl text-primary-500" />
          <span class="font-bold text-lg">Libroo</span>
        </NuxtLink>
      </template>

      <template #right>
        <UColorModeButton />

        <template v-if="session.data?.user">
          <NuxtLink to="/library">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-book-open"
            >
              My Library
            </UButton>
          </NuxtLink>
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
          <NuxtLink to="/auth/login">
            <UButton
              color="neutral"
              variant="ghost"
            >
              Sign In
            </UButton>
          </NuxtLink>
          <NuxtLink to="/auth/register">
            <UButton
              color="primary"
            >
              Get Started
            </UButton>
          </NuxtLink>
        </template>
      </template>
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>

    <USeparator icon="i-lucide-library" />

    <UFooter>
      <template #left>
        <p class="text-sm text-muted">
          Libroo - Your Library, Managed • © {{ new Date().getFullYear() }}
        </p>
      </template>

      <template #right>
        <UButton
          to="https://github.com"
          target="_blank"
          icon="i-simple-icons-github"
          aria-label="GitHub"
          color="neutral"
          variant="ghost"
        />
      </template>
    </UFooter>
  </UApp>
</template>
