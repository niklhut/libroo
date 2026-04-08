import { defineStore } from 'pinia'
import { computed, unref } from 'vue'
import { authClient } from '~/utils/auth-client'

export const useAuthStore = defineStore('auth', () => {
  const { $authSession } = useNuxtApp()
  const session = $authSession

  const user = computed(() => unref(session.data)?.user ?? null)
  const userSession = computed(() => unref(session.data)?.session ?? null)
  const isAuthenticated = computed(() => !!unref(session.data)?.user)
  const isPending = computed(() => {
    const pending = session.isPending
    return unref(pending) ?? true
  })
  const error = computed(() => unref(session.error) ?? null)

  async function signIn(email: string, password: string) {
    return authClient.signIn.email({
      email,
      password
    })
  }

  async function signUp(email: string, password: string, name: string) {
    return authClient.signUp.email({
      email,
      password,
      name
    })
  }

  async function signOut() {
    await authClient.signOut()
  }

  return {
    user,
    session: userSession,
    isAuthenticated,
    isPending,
    error,
    signIn,
    signUp,
    signOut
  }
})
