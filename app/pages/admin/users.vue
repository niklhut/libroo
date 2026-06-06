<script setup lang="ts">
import type { TableColumn, TableRow } from '@nuxt/ui/components/Table.vue'
import type { AdminUser, AdminUsersPage } from '~~/shared/types/admin'

const toast = useToast()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const { user: currentUser } = storeToRefs(authStore)
const updatingUserId = ref<string | null>(null)
const adminAuth = useAuth()
const requestFetch = useRequestFetch()
const pageSize = 25

const currentPage = computed({
  get: () => parsePage(route.query.page),
  set: (page: number) => {
    router.push({
      query: pageQuery(page)
    })
  }
})

const { data: usersPage, status, error } = await useAsyncData<AdminUsersPage>(
  'admin-users',
  () => loadUsers(currentPage.value),
  {
    default: () => emptyUsersPage(currentPage.value),
    watch: [currentPage]
  }
)

const users = computed(() => usersPage.value.users)
const totalUsers = computed(() => usersPage.value.total)
const totalPages = computed(() => Math.max(1, Math.ceil(totalUsers.value / pageSize)))
const pageStart = computed(() => totalUsers.value === 0 ? 0 : ((currentPage.value - 1) * pageSize) + 1)
const pageEnd = computed(() => Math.min(currentPage.value * pageSize, totalUsers.value))
const isLoadingUsers = computed(() => ['idle', 'pending'].includes(status.value))
const isInvalidPage = computed(() => !isLoadingUsers.value && currentPage.value > totalPages.value)
const isInitialLoading = computed(() => (isLoadingUsers.value || isInvalidPage.value) && users.value.length === 0)

if (isInvalidPage.value) {
  await navigateTo({ path: route.path, query: pageQuery(totalPages.value) }, { replace: true })
}

watch(isInvalidPage, (invalid) => {
  if (invalid) {
    router.replace({ query: pageQuery(totalPages.value) })
  }
})

const columns: TableColumn<AdminUser>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'createdAt', header: 'Created' },
  { accessorKey: 'lastActiveAt', header: 'Last active' },
  { accessorKey: 'role', header: 'Role' },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', header: '' }
]

function formatDate(value: string | Date | null) {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value))
}

function roleColor(role: AdminUser['role']) {
  return role === 'admin' ? 'primary' : 'neutral'
}

function statusColor(accountStatus: AdminUser['status']) {
  return accountStatus === 'active' ? 'success' : 'error'
}

function canDemote(user: AdminUser) {
  return user.isAdmin && user.id !== currentUser.value?.id
}

function originalUser(row: TableRow<AdminUser>) {
  return row.original
}

async function setRole(user: AdminUser, role: AdminUser['role']) {
  if (updatingUserId.value) return

  updatingUserId.value = user.id
  try {
    await unwrapAuthResponse(adminAuth.admin.setRole({
      userId: user.id,
      role
    }))
    usersPage.value = {
      ...usersPage.value,
      users: users.value.map(item =>
        item.id === user.id
          ? { ...item, role, isAdmin: role === 'admin' }
          : item
      )
    }
    toast.add({
      title: role === 'admin' ? 'Admin promoted' : 'Admin rights removed',
      color: 'success'
    })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'Unable to update role')
    toast.add({
      title: 'Could not update role',
      description: message,
      color: 'error'
    })
  } finally {
    updatingUserId.value = null
  }
}

async function loadUsers(pageNumber: number): Promise<AdminUsersPage> {
  return requestFetch('/api/admin/users', {
    query: {
      page: pageNumber,
      pageSize
    }
  })
}

function emptyUsersPage(page: number): AdminUsersPage {
  return {
    users: [],
    total: 0,
    page,
    pageSize
  }
}

function parsePage(value: typeof route.query.page) {
  const rawValue = Array.isArray(value) ? value[0] : value
  const page = Number(rawValue ?? 1)
  return Number.isInteger(page) && page > 0 ? page : 1
}

function pageQuery(page: number) {
  return {
    ...route.query,
    page: page > 1 ? String(page) : undefined
  }
}

async function unwrapAuthResponse<T>(promise: Promise<{ data: T | null, error: { message?: string } | null }>) {
  const { data, error } = await promise
  if (error || !data) {
    throw new Error(error?.message ?? 'Request failed')
  }
  return data
}
</script>

<template>
  <UContainer>
    <UPageHeader
      title="Users"
      :description="`${totalUsers} registered ${totalUsers === 1 ? 'user' : 'users'}`"
    />

    <UPageBody>
      <div
        v-if="isInitialLoading"
        class="flex justify-center py-12"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="animate-spin text-4xl text-muted"
        />
      </div>

      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        title="Could not load users"
        :description="error.message"
      />

      <UCard
        v-else-if="users.length === 0"
        class="text-center py-12"
      >
        <UIcon
          name="i-lucide-users"
          class="text-6xl text-muted mx-auto mb-4"
        />
        <h2 class="text-xl font-semibold mb-2">
          No registered users
        </h2>
        <p class="text-muted">
          Signed up users will appear here.
        </p>
      </UCard>

      <template v-else>
        <UTable
          :data="users"
          :columns="columns"
        >
          <template #createdAt-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatDate(originalUser(row).createdAt) }}</span>
          </template>

          <template #lastActiveAt-cell="{ row }">
            <span class="whitespace-nowrap">{{ formatDate(originalUser(row).lastActiveAt) }}</span>
          </template>

          <template #role-cell="{ row }">
            <UBadge
              :color="roleColor(originalUser(row).role)"
              variant="subtle"
            >
              {{ originalUser(row).role }}
            </UBadge>
          </template>

          <template #status-cell="{ row }">
            <UBadge
              :color="statusColor(originalUser(row).status)"
              variant="subtle"
            >
              {{ originalUser(row).status }}
            </UBadge>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex justify-end">
              <UButton
                v-if="originalUser(row).isAdmin"
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-shield-minus"
                :disabled="!canDemote(originalUser(row))"
                :loading="updatingUserId === originalUser(row).id"
                @click="setRole(originalUser(row), 'user')"
              >
                Demote
              </UButton>
              <UButton
                v-else
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-shield-plus"
                :loading="updatingUserId === originalUser(row).id"
                @click="setRole(originalUser(row), 'admin')"
              >
                Promote
              </UButton>
            </div>
          </template>
        </UTable>

        <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p class="text-sm text-muted">
            Showing {{ pageStart }}-{{ pageEnd }} of {{ totalUsers }} users
          </p>

          <UPagination
            v-if="totalUsers > pageSize"
            v-model:page="currentPage"
            :total="totalUsers"
            :items-per-page="pageSize"
            show-edges
          />
        </div>
      </template>
    </UPageBody>
  </UContainer>
</template>
