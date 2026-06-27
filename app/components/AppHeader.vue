<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { roleIncludesAdmin } from '~~/shared/utils/auth-roles'
import { booleanConfigValue } from '~~/shared/utils/runtime-config'

const authStore = useAuthStore()
const { user } = storeToRefs(authStore)
const { signOut } = authStore
const route = useRoute()
const config = useRuntimeConfig()
const registrationEnabled = computed(() => booleanConfigValue(config.public.registrationEnabled, true))

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

const primaryLinks = [
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
    label: 'Locations',
    icon: 'i-lucide-map',
    to: '/library/locations'
  }
]

const accountLinks = [
  {
    label: 'Settings',
    icon: 'i-lucide-settings',
    to: '/settings'
  }
]

const adminLinks = computed(() => [
  {
    label: 'Users',
    icon: 'i-lucide-users',
    to: '/admin/users'
  },
  ...(!registrationEnabled.value
    ? [{
        label: 'Invites',
        icon: 'i-lucide-user-plus',
        to: '/admin/invites'
      }]
    : []),
  {
    label: 'Audit',
    icon: 'i-lucide-scroll-text',
    to: '/admin/audit'
  }
])

const isAdmin = computed(() => Boolean(user.value && roleIncludesAdmin(user.value.role)))
</script>

<template>
  <UHeader>
    <template #left>
      <NuxtLink
        :to="logoTo"
        class="flex items-center gap-2"
      >
        <NuxtImg
          src="/Libroo_Icon.svg"
          alt=""
          aria-hidden="true"
          width="28"
          height="28"
          class="size-7 shrink-0"
        />
        <span class="font-bold text-xl">Libroo</span>
      </NuxtLink>
    </template>

    <template #right>
      <nav
        v-if="user"
        aria-label="Main navigation"
        class="hidden lg:flex items-center gap-1.5"
      >
        <UButton
          v-for="link in primaryLinks"
          :key="link.label"
          :to="link.to"
          :icon="link.icon"
          color="neutral"
          variant="ghost"
          size="sm"
        >
          {{ link.label }}
        </UButton>

        <div
          v-if="isAdmin"
          class="relative group"
        >
          <UButton
            to="/admin/users"
            icon="i-lucide-shield"
            trailing-icon="i-lucide-chevron-down"
            color="neutral"
            variant="ghost"
            size="sm"
            :class="route.path.startsWith('/admin') ? 'text-primary' : undefined"
          >
            Admin
          </UButton>
          <div class="invisible absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-default bg-default p-1 opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
            <UButton
              v-for="link in adminLinks"
              :key="link.label"
              :to="link.to"
              :icon="link.icon"
              color="neutral"
              variant="ghost"
              size="sm"
              block
              class="justify-start"
            >
              {{ link.label }}
            </UButton>
          </div>
        </div>

        <UButton
          v-for="link in accountLinks"
          :key="link.label"
          :to="link.to"
          :icon="link.icon"
          color="neutral"
          variant="ghost"
          size="sm"
        >
          {{ link.label }}
        </UButton>

        <UButton
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          size="sm"
          @click="handleSignOut"
        >
          Sign Out
        </UButton>
      </nav>

      <UColorModeButton />
    </template>

    <template #body>
      <nav
        v-if="user"
        aria-label="Mobile navigation"
        class="-mx-2 flex flex-col gap-1"
      >
        <UButton
          v-for="link in primaryLinks"
          :key="link.label"
          :to="link.to"
          :icon="link.icon"
          color="neutral"
          variant="ghost"
          block
          class="justify-start"
        >
          {{ link.label }}
        </UButton>

        <details
          v-if="isAdmin"
          class="group"
          :open="route.path.startsWith('/admin')"
        >
          <summary
            class="flex cursor-pointer list-none items-center gap-2 rounded-md px-2.5 py-2 text-sm font-medium text-muted outline-none hover:bg-elevated hover:text-highlighted focus-visible:ring-2 focus-visible:ring-primary"
            :class="route.path.startsWith('/admin') ? 'text-primary' : undefined"
          >
            <UIcon
              name="i-lucide-shield"
              class="size-5 shrink-0"
            />
            <span>Admin</span>
            <UIcon
              name="i-lucide-chevron-down"
              class="ms-auto size-5 shrink-0 transition-transform group-open:rotate-180"
            />
          </summary>
          <div class="ms-6 mt-1 flex flex-col gap-1">
            <UButton
              v-for="link in adminLinks"
              :key="link.label"
              :to="link.to"
              :icon="link.icon"
              color="neutral"
              variant="ghost"
              block
              class="justify-start"
            >
              {{ link.label }}
            </UButton>
          </div>
        </details>

        <UButton
          v-for="link in accountLinks"
          :key="link.label"
          :to="link.to"
          :icon="link.icon"
          color="neutral"
          variant="ghost"
          block
          class="justify-start"
        >
          {{ link.label }}
        </UButton>

        <UButton
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          block
          class="justify-start"
          @click="handleSignOut"
        >
          Sign Out
        </UButton>
      </nav>
    </template>
  </UHeader>
</template>
