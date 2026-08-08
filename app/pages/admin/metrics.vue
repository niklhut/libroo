<script setup lang="ts">
import type { AdminMetrics } from '~~/shared/types/admin'
import { formatAdminDateTime } from '~/utils/admin-date-format'

usePageTitle('Admin Metrics')

const requestFetch = useRequestFetch()
const { data: metrics, status, error } = await useAsyncData<AdminMetrics>(
  'admin-metrics',
  () => requestFetch('/api/admin/metrics')
)

const isLoading = computed(() => ['idle', 'pending'].includes(status.value))
const storageUsage = computed(() => metrics.value?.storage)

function formatBytes(totalBytes: number) {
  if (totalBytes >= 1024 * 1024 * 1024) return `${(totalBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  return `${(totalBytes / (1024 * 1024)).toFixed(2)} MB`
}
</script>

<template>
  <UContainer>
    <UPageHeader
      title="Metrics"
      description="Aggregate operational metadata for this Libroo instance."
    />

    <UPageBody>
      <div
        v-if="isLoading"
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
        title="Could not load metrics"
        :description="error.message"
      />

      <template v-else-if="metrics">
        <section class="space-y-3">
          <h2 class="text-lg font-semibold">
            Users
          </h2>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <UCard>
              <p class="text-sm text-muted">
                Total users
              </p>
              <p class="mt-1 text-3xl font-semibold">
                {{ metrics.users }}
              </p>
            </UCard>
          </div>
        </section>

        <section class="mt-8 space-y-3">
          <h2 class="text-lg font-semibold">
            Library
          </h2>
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <UCard>
              <p class="text-sm text-muted">
                Canonical books
              </p>
              <p class="mt-1 text-3xl font-semibold">
                {{ metrics.library.canonicalBooks }}
              </p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">
                Active library entries
              </p>
              <p class="mt-1 text-3xl font-semibold">
                {{ metrics.library.activeUserBooks }}
              </p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">
                Active loans
              </p>
              <p class="mt-1 text-3xl font-semibold">
                {{ metrics.library.activeLoans }}
              </p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">
                Locations
              </p>
              <p class="mt-1 text-3xl font-semibold">
                {{ metrics.library.locations }}
              </p>
            </UCard>
            <UCard>
              <p class="text-sm text-muted">
                Tags
              </p>
              <p class="mt-1 text-3xl font-semibold">
                {{ metrics.library.tags }}
              </p>
            </UCard>
          </div>
        </section>

        <section class="mt-8 space-y-3">
          <h2 class="text-lg font-semibold">
            Storage
          </h2>
          <UCard v-if="storageUsage?.state === 'unavailable'">
            <p class="text-sm text-muted">
              Approximate cover storage
            </p>
            <p class="mt-1 text-lg font-semibold">
              Not available
            </p>
          </UCard>
          <UCard v-else-if="storageUsage">
            <div class="flex flex-wrap items-center gap-2">
              <p class="text-sm text-muted">
                Approximate cover storage
              </p>
              <UBadge
                v-if="storageUsage.state === 'stale'"
                color="warning"
                variant="subtle"
              >
                Stale
              </UBadge>
            </div>
            <p class="mt-1 text-3xl font-semibold">
              {{ formatBytes(storageUsage.totalBytes) }}
            </p>
            <p class="mt-2 text-sm text-muted">
              {{ storageUsage.objectCount }} cover blobs
            </p>
            <p class="mt-1 text-sm text-muted">
              Last calculated: {{ formatAdminDateTime(storageUsage.lastCalculatedAt) }}
            </p>
          </UCard>
        </section>
      </template>
    </UPageBody>
  </UContainer>
</template>
