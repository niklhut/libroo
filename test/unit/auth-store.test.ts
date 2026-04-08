import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { ref } from 'vue'

import { useAuthStore } from '../../app/stores/auth'

const authClientMocks = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  signOut: vi.fn()
}))

vi.mock('~/utils/auth-client', () => ({
  authClient: {
    signIn: {
      email: authClientMocks.signInEmail
    },
    signUp: {
      email: authClientMocks.signUpEmail
    },
    signOut: authClientMocks.signOut
  }
}))

describe('useAuthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    authClientMocks.signInEmail.mockReset()
    authClientMocks.signUpEmail.mockReset()
    authClientMocks.signOut.mockReset()
  })

  it('derives auth state from the injected session', () => {
    const session = {
      data: ref({
        user: { id: 'u1', email: 'ada@example.com' },
        session: { id: 's1' }
      }),
      error: ref<Error | null>(null),
      isPending: ref(false)
    }

    ;(globalThis as unknown as { useNuxtApp: () => { $authSession: typeof session } }).useNuxtApp = () => ({
      $authSession: session
    })

    const store = useAuthStore()
    const { user, session: userSession, isAuthenticated, isPending, error } = storeToRefs(store)

    expect(user.value).toEqual({ id: 'u1', email: 'ada@example.com' })
    expect(userSession.value).toEqual({ id: 's1' })
    expect(isAuthenticated.value).toBe(true)
    expect(isPending.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('proxies auth actions to the shared auth client', async () => {
    const session = {
      data: ref(null),
      error: ref<Error | null>(null),
      isPending: ref(false)
    }

    ;(globalThis as unknown as { useNuxtApp: () => { $authSession: typeof session } }).useNuxtApp = () => ({
      $authSession: session
    })

    authClientMocks.signInEmail.mockResolvedValueOnce({ error: null })
    authClientMocks.signUpEmail.mockResolvedValueOnce({ error: null })
    authClientMocks.signOut.mockResolvedValueOnce(undefined)

    const store = useAuthStore()

    await expect(store.signIn('ada@example.com', 'secret')).resolves.toEqual({ error: null })
    await expect(store.signUp('ada@example.com', 'secret', 'Ada')).resolves.toEqual({ error: null })
    await expect(store.signOut()).resolves.toBeUndefined()

    expect(authClientMocks.signInEmail).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'secret'
    })
    expect(authClientMocks.signUpEmail).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'secret',
      name: 'Ada'
    })
    expect(authClientMocks.signOut).toHaveBeenCalledTimes(1)
  })
})
