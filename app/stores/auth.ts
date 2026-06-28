import { defineStore } from 'pinia'
import type { Ref } from 'vue'
import { computed, unref } from 'vue'
import { authClient } from '~/utils/auth-client'

interface InjectedAuthSession {
  data: Ref<{ user?: AuthUser, session?: Record<string, unknown> } | null>
  error: Ref<unknown>
  isPending: Ref<boolean>
  refetch: () => Promise<void>
}

interface AuthUser extends Record<string, unknown> {
  id?: string
  email?: string
  emailVerified?: boolean
  role?: string | string[] | null
  banned?: boolean
  banExpires?: Date | string | null
}

export const useAuthStore = defineStore('auth', () => {
  const { $authSession } = useNuxtApp()
  const session = $authSession as InjectedAuthSession

  const user = computed(() => unref(session.data)?.user ?? null)
  const userSession = computed(() => unref(session.data)?.session ?? null)
  const isAuthenticated = computed(() => !!unref(session.data)?.user)
  const status = computed(() => {
    if (unref(session.error)) return 'error'
    return unref(session.data)?.user ? 'authenticated' : 'unauthenticated'
  })
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

  async function refresh() {
    await session.refetch()
  }

  return {
    user,
    session: userSession,
    status,
    isAuthenticated,
    isPending,
    error,
    signIn,
    signUp,
    signOut,
    refresh
  }
})
