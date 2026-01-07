<script setup lang="ts">
// Default layout with header and page structure
const { session, signOut } = useAuth()

async function handleSignOut() {
  await signOut()
  navigateTo('/auth/login')
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Header -->
    <header class="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-default">
      <UContainer>
        <div class="flex items-center justify-between h-16">
          <!-- Left: Logo -->
          <NuxtLink to="/" class="flex items-center gap-2">
            <UIcon name="i-lucide-book-open-check" class="text-2xl text-primary" />
            <span class="font-bold text-xl">Libroo</span>
          </NuxtLink>

          <!-- Right: Navigation -->
          <div class="flex items-center gap-2">
            <UColorModeButton />

            <template v-if="session.data?.user">
              <NuxtLink to="/library">
                <UButton
                  color="neutral"
                  variant="ghost"
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
                <UButton color="neutral" variant="ghost">
                  Sign In
                </UButton>
              </NuxtLink>
              <NuxtLink to="/auth/register">
                <UButton>
                  Get Started
                </UButton>
              </NuxtLink>
            </template>
          </div>
        </div>
      </UContainer>
    </header>

    <!-- Main Content -->
    <main class="flex-1">
      <slot />
    </main>
  </div>
</template>
