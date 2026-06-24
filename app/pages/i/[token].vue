<script setup lang="ts">
import type { BorrowedBook, InvitePreview } from '~~/shared/types/book'

definePageMeta({
  auth: false
})

const route = useRoute()
const toast = useToast()
const authStore = useAuthStore()
const { user } = storeToRefs(authStore)

const token = route.params.token as string
const isAccepting = ref(false)

const { data: invite, status } = await useFetch<InvitePreview | null>(`/api/invite/${token}`, {
  default: () => null
})

usePageTitle(computed(() => invite.value?.title ? `Invitation: ${invite.value.title}` : 'Book Invitation'))

const coverUrl = computed(() => invite.value?.coverPath ? `/api/invite/${token}/cover` : null)
const redirectPath = computed(() => `/i/${token}`)
const isSignedIn = computed(() => Boolean(user.value))

function formatDate(value: Date | string | null): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

async function acceptBook() {
  if (!isSignedIn.value || !invite.value?.canAccept || isAccepting.value) return

  isAccepting.value = true
  try {
    await $fetch<BorrowedBook>(`/api/invite/${token}/accept`, {
      method: 'POST',
      credentials: 'same-origin'
    })
    toast.add({
      title: 'Added to borrowed books',
      color: 'success'
    })
    await navigateTo({ path: '/library/loans', query: { view: 'borrowed' } })
  } catch (err: unknown) {
    const message = (err as { data?: { message?: string } })?.data?.message
      ?? (err instanceof Error ? err.message : 'This invitation is no longer available')
    toast.add({
      title: 'Could not add book',
      description: message,
      color: 'error'
    })
  } finally {
    isAccepting.value = false
  }
}
</script>

<template>
  <UContainer class="py-10 max-w-3xl">
    <div
      v-if="status === 'pending'"
      class="flex justify-center py-12"
    >
      <UIcon
        name="i-lucide-loader-2"
        class="animate-spin text-4xl text-muted"
      />
    </div>

    <UCard
      v-else-if="!invite"
      class="text-center py-12"
    >
      <UIcon
        name="i-lucide-link-2-off"
        class="text-6xl text-muted mx-auto mb-4"
      />
      <h1 class="text-2xl font-bold mb-2">
        Invitation unavailable
      </h1>
      <p class="text-muted">
        This invite may have already been used or canceled.
      </p>
    </UCard>

    <div
      v-else
      class="grid gap-8 md:grid-cols-[220px_1fr] md:items-start"
    >
      <div class="mx-auto w-44 md:w-full">
        <div class="rounded-lg overflow-hidden shadow-lg">
          <NuxtImg
            v-if="coverUrl"
            :src="coverUrl"
            :alt="invite.title"
            class="w-full object-cover"
          />
          <div
            v-else
            class="aspect-[2/3] bg-muted flex items-center justify-center"
          >
            <UIcon
              name="i-lucide-book"
              class="text-6xl text-muted"
            />
          </div>
        </div>
      </div>

      <div class="space-y-5 text-center md:text-left">
        <UBadge
          color="primary"
          variant="subtle"
          size="lg"
        >
          This book was lent to you
        </UBadge>
        <div>
          <h1 class="text-3xl font-bold tracking-tight">
            {{ invite.title }}
          </h1>
          <p class="mt-2 text-lg text-muted">
            {{ invite.author }}
          </p>
          <p class="mt-4 text-muted">
            {{ invite.ownerName }} shared this book with you.
          </p>
          <p
            v-if="invite.dueAt"
            class="mt-2 text-sm text-muted"
          >
            Due {{ formatDate(invite.dueAt) }}
          </p>
        </div>

        <UAlert
          v-if="invite.isOwnInvite"
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          title="This is your invite"
          description="You created this lending invite, so it cannot be added to your borrowed books."
        />

        <UAlert
          v-else-if="!invite.canAccept"
          color="warning"
          variant="subtle"
          icon="i-lucide-circle-alert"
          title="This invite is no longer available"
          description="It may have already been accepted, returned, or canceled."
        />

        <div class="flex flex-col sm:flex-row gap-3 justify-center md:justify-start">
          <template v-if="invite.canAccept && isSignedIn">
            <UButton
              size="lg"
              icon="i-lucide-book-plus"
              :loading="isAccepting"
              :disabled="isAccepting"
              @click="acceptBook"
            >
              Add to borrowed books
            </UButton>
          </template>
          <template v-else-if="invite.canAccept">
            <UButton
              size="lg"
              icon="i-lucide-log-in"
              :to="{ path: '/login', query: { redirect: redirectPath } }"
            >
              Sign in
            </UButton>
            <UButton
              size="lg"
              color="neutral"
              variant="outline"
              icon="i-lucide-user-plus"
              :to="{ path: '/register', query: { redirect: redirectPath } }"
            >
              Create account
            </UButton>
          </template>
          <UButton
            v-else
            color="neutral"
            variant="outline"
            icon="i-lucide-library"
            to="/library"
          >
            Go to library
          </UButton>
        </div>
      </div>
    </div>
  </UContainer>
</template>
