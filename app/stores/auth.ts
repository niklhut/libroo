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

  async function signUp(email: string, password: string, name: string, inviteToken?: string | null, turnstileToken?: string | null, acceptTerms?: boolean | null) {
    const body = {
      email,
      password,
      name,
      inviteToken: inviteToken || undefined,
      acceptTerms: acceptTerms ?? undefined,
      fetchOptions: turnstileToken
        ? {
            headers: {
              'x-captcha-response': turnstileToken
            }
          }
        : undefined
    } as Parameters<typeof authClient.signUp.email>[0] & { inviteToken?: string, acceptTerms?: boolean }

    return authClient.signUp.email(body)
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
