import { watch } from 'vue'

export default defineNuxtPlugin(() => {
  const authStore = useAuthStore()
  const { clearUserScopedState } = useClearUserScopedState()

  watch(
    () => authStore.user?.id ?? null,
    (userId, previousUserId) => {
      if (previousUserId !== undefined && userId !== previousUserId) {
        clearUserScopedState()
      }
    }
  )
})
