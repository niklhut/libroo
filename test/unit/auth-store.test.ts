import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia, storeToRefs } from 'pinia'
import { ref } from 'vue'

import { useAuthStore } from '../../app/stores/auth'
import { useIsbnLookupStore } from '../../app/stores/isbnLookup'
import { useIsbnScannerStore } from '../../app/stores/isbnScanner'
import { useLibraryDashboardStore } from '../../app/stores/libraryDashboard'

const _origUseNuxtApp = (globalThis as { useNuxtApp?: unknown }).useNuxtApp

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
    ;(globalThis as unknown as { useToast: () => { add: () => void } }).useToast = () => ({ add: () => undefined })
  })

  afterEach(() => {
    if (typeof _origUseNuxtApp === 'undefined') {
      delete (globalThis as { useNuxtApp?: unknown }).useNuxtApp
      return
    }

    ;(globalThis as { useNuxtApp?: unknown }).useNuxtApp = _origUseNuxtApp
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
    const { user, session: userSession, status, isAuthenticated, isPending, error } = storeToRefs(store)

    expect(user.value).toEqual({ id: 'u1', email: 'ada@example.com' })
    expect(userSession.value).toEqual({ id: 's1' })
    expect(status.value).toBe('authenticated')
    expect(isAuthenticated.value).toBe(true)
    expect(isPending.value).toBe(false)
    expect(error.value).toBeNull()
  })

  it('surfaces session lookup errors distinctly from signed-out state', () => {
    const session = {
      data: ref(null),
      error: ref({ name: 'Error', message: 'database offline' }),
      isPending: ref(false)
    }

    ;(globalThis as unknown as { useNuxtApp: () => { $authSession: typeof session } }).useNuxtApp = () => ({
      $authSession: session
    })

    const store = useAuthStore()
    const { status, isAuthenticated, error } = storeToRefs(store)

    expect(status.value).toBe('error')
    expect(isAuthenticated.value).toBe(false)
    expect(error.value).toEqual({ name: 'Error', message: 'database offline' })
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
    await expect(store.signUp('ada@example.com', 'secret', 'Ada', 'invite-token')).resolves.toEqual({ error: null })
    await expect(store.signOut()).resolves.toBeUndefined()

    expect(authClientMocks.signInEmail).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'secret'
    })
    expect(authClientMocks.signUpEmail).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'secret',
      name: 'Ada',
      inviteToken: 'invite-token',
      acceptTerms: undefined,
      fetchOptions: undefined
    })
    expect(authClientMocks.signOut).toHaveBeenCalledTimes(1)
  })

  it('clears user-scoped stores and session data on sign-out', async () => {
    const session = {
      data: ref({ user: { id: 'account-a', email: 'a@example.com' }, session: { id: 'session-a' } }),
      error: ref<Error | null>(null),
      isPending: ref(false)
    }
    ;(globalThis as unknown as { useNuxtApp: () => { $authSession: typeof session } }).useNuxtApp = () => ({ $authSession: session })
    authClientMocks.signOut.mockResolvedValueOnce(undefined)

    const dashboardStore = useLibraryDashboardStore()
    dashboardStore.search = 'account A book'
    dashboardStore.allBooks = [{ id: 'book-a', bookId: 'book-a', libraryState: 'owned', title: 'Account A title', author: 'Author', isbn: '9781234567890', coverPath: null, addedAt: new Date().toISOString() }]
    dashboardStore.shouldSync = true
    const lookupStore = useIsbnLookupStore()
    lookupStore.lookupError = 'lookup failed'
    lookupStore.addError = 'add failed'
    const scannerStore = useIsbnScannerStore()
    scannerStore.scannedBooks = [{ isbn: '9781234567890', status: 'found', selected: true }]
    scannerStore.targetLibraryState = 'wishlisted'

    await useAuthStore().signOut()

    expect(session.data.value).toBeNull()
    expect(dashboardStore.allBooks).toEqual([])
    expect(dashboardStore.search).toBe('')
    expect(dashboardStore.shouldSync).toBe(false)
    expect(scannerStore.scannedBooks).toEqual([])
    expect(scannerStore.targetLibraryState).toBe('owned')
    expect(lookupStore.lookupError).toBeNull()
    expect(lookupStore.addError).toBeNull()
  })

  it('passes the Turnstile token as a captcha response header on signup', async () => {
    const session = {
      data: ref(null),
      error: ref<Error | null>(null),
      isPending: ref(false)
    }

    ;(globalThis as unknown as { useNuxtApp: () => { $authSession: typeof session } }).useNuxtApp = () => ({
      $authSession: session
    })

    authClientMocks.signUpEmail.mockResolvedValueOnce({ error: null })

    const store = useAuthStore()

    await expect(store.signUp('ada@example.com', 'secret', 'Ada', 'invite-token', 'turnstile-token')).resolves.toEqual({ error: null })

    expect(authClientMocks.signUpEmail).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'secret',
      name: 'Ada',
      inviteToken: 'invite-token',
      acceptTerms: undefined,
      fetchOptions: {
        headers: {
          'x-captcha-response': 'turnstile-token'
        }
      }
    })
  })

  it('passes Terms acceptance on signup', async () => {
    const session = {
      data: ref(null),
      error: ref<Error | null>(null),
      isPending: ref(false)
    }

    ;(globalThis as unknown as { useNuxtApp: () => { $authSession: typeof session } }).useNuxtApp = () => ({
      $authSession: session
    })

    authClientMocks.signUpEmail.mockResolvedValueOnce({ error: null })

    const store = useAuthStore()

    await expect(store.signUp('ada@example.com', 'secret', 'Ada', null, null, true)).resolves.toEqual({ error: null })

    expect(authClientMocks.signUpEmail).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'secret',
      name: 'Ada',
      inviteToken: undefined,
      acceptTerms: true,
      fetchOptions: undefined
    })
  })
})
