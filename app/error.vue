<script setup lang="ts">
import { clearError } from '#app'
import type { NuxtError } from '#app'

const props = defineProps<{
  error: NuxtError
}>()

const statusCode = computed(() => props.error.statusCode)
const statusMessage = computed(() => props.error.statusMessage)
const isNotFound = computed(() => statusCode.value === 404)

const icon = computed(() =>
  isNotFound.value ? 'i-lucide-file-question' : 'i-lucide-alert-circle'
)
const title = computed(() =>
  isNotFound.value ? 'Page not found' : 'Something went wrong'
)
const description = computed(() =>
  isNotFound.value
    ? 'The requested page or resource is unavailable.'
    : 'Libroo could not finish loading this page. Please return home and try again.'
)
const authSession = useNuxtApp().$authSession as { data?: { value?: { user?: unknown } | null } } | undefined
const recoveryPath = computed(() => authSession?.data?.value?.user ? '/library' : '/login?redirect=/library')

function handleHome() {
  return clearError({ redirect: recoveryPath.value })
}
</script>

<template>
  <UApp>
    <UContainer class="min-h-dvh py-12 max-w-md flex items-center justify-center">
      <UPageCard
        variant="naked"
        class="w-full"
      >
        <div class="w-full text-center space-y-8">
          <div class="space-y-4">
            <UIcon
              :name="icon"
              class="size-8 text-muted"
            />

            <div class="space-y-2">
              <p class="text-sm font-medium text-muted">
                Error {{ statusCode }}
              </p>

              <h1 class="text-xl font-semibold text-highlighted">
                {{ title }}
              </h1>

              <p class="text-base text-muted text-pretty">
                {{ description }}
              </p>

              <p class="sr-only">
                {{ statusMessage }}
              </p>
            </div>
          </div>

          <div class="flex justify-center">
            <UButton
              icon="i-lucide-library"
              size="md"
              @click="handleHome"
            >
              Return to library
            </UButton>
          </div>
        </div>
      </UPageCard>
    </UContainer>
  </UApp>
</template>
