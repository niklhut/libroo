import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const authClientMocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  useSession: vi.fn()
}))

vi.mock('~/utils/auth-client', () => ({
  authClient: {
    signOut: authClientMocks.signOut,
    useSession: authClientMocks.useSession
  }
}))

type PluginResult = {
  provide: {
    authSession: {
      data: ReturnType<typeof ref>
      error: ReturnType<typeof ref>
      isPending: ReturnType<typeof ref> | boolean
    }
  }
}

type RouteMiddleware = (to: {
  fullPath: string
  meta: { auth?: boolean }
  path: string
}) => Promise<unknown>

const originalGlobals = {
  defineNuxtPlugin: globalThis.defineNuxtPlugin,
  defineNuxtRouteMiddleware: globalThis.defineNuxtRouteMiddleware,
  createError: globalThis.createError,
  navigateTo: globalThis.navigateTo,
  useEmailCapabilities: globalThis.useEmailCapabilities,
  useFetch: globalThis.useFetch,
  useNuxtApp: globalThis.useNuxtApp,
  useRoute: globalThis.useRoute
}

let initializeAuthSession: (typeof import('../../app/utils/auth-session'))['initializeAuthSession']
let authMiddleware: RouteMiddleware
let routeMeta: { auth?: boolean, authSession?: boolean }
let nuxtApp: { $authSession: PluginResult['provide']['authSession'] }
const navigateTo = vi.fn()

beforeAll(async () => {
  vi.stubGlobal('defineNuxtPlugin', (plugin: () => Promise<PluginResult>) => plugin)
  vi.stubGlobal('defineNuxtRouteMiddleware', (middleware: RouteMiddleware) => middleware)
  vi.stubGlobal('createError', (input: unknown) => input)
  vi.stubGlobal('navigateTo', navigateTo)
  vi.stubGlobal('useEmailCapabilities', () => ({
    data: ref({ emailVerificationEnabled: true }),
    error: ref(null)
  }))
  vi.stubGlobal('useFetch', vi.fn())
  vi.stubGlobal('useRoute', () => ({ meta: routeMeta }))
  vi.stubGlobal('useNuxtApp', () => nuxtApp)

  initializeAuthSession = (await import('../../app/utils/auth-session')).initializeAuthSession as typeof initializeAuthSession
  authMiddleware = (await import('../../app/middleware/auth.global')).default as unknown as RouteMiddleware
})

beforeEach(() => {
  authClientMocks.signOut.mockReset()
  authClientMocks.useSession.mockReset()
  navigateTo.mockReset()
  routeMeta = {}
})

afterAll(() => {
  for (const [name, value] of Object.entries(originalGlobals)) {
    if (typeof value === 'undefined') {
      Reflect.deleteProperty(globalThis, name)
    } else {
      Reflect.set(globalThis, name, value)
    }
  }
})

describe('auth session initialization', () => {
  it('fetches once in the plugin and reuses the injected session in middleware', async () => {
    const publicFetch = vi.spyOn(globalThis, 'fetch')
    const session = {
      data: ref({
        user: {
          id: 'u1',
          email: 'ada@example.com',
          emailVerified: true,
          role: 'user'
        },
        session: { id: 's1' }
      }),
      error: ref(null),
      isPending: ref(false)
    }
    authClientMocks.useSession.mockResolvedValueOnce(session)
    const resolveServerSession = vi.fn().mockResolvedValueOnce(session.data.value)

    const authSession = await initializeAuthSession(true, resolveServerSession)
    nuxtApp = { $authSession: authSession }

    await expect(authMiddleware({
      fullPath: '/library',
      meta: {},
      path: '/library'
    })).resolves.toBeUndefined()

    expect(resolveServerSession).toHaveBeenCalledTimes(1)
    expect(publicFetch).not.toHaveBeenCalled()
    expect(authClientMocks.useSession).not.toHaveBeenCalled()
    expect(nuxtApp.$authSession.data.value).toEqual(session.data.value)
    expect(navigateTo).not.toHaveBeenCalled()
    publicFetch.mockRestore()
  })

  it('skips server initialization for public routes that do not need auth state', async () => {
    routeMeta = { auth: false }

    const resolveServerSession = vi.fn()
    const authSession = await initializeAuthSession(true, resolveServerSession)

    expect(authClientMocks.useSession).not.toHaveBeenCalled()
    expect(resolveServerSession).not.toHaveBeenCalled()
    expect(authSession.data.value).toBeNull()
    expect(authSession.isPending.value).toBe(false)
  })

  it('initializes auth-aware public routes without making middleware fetch again', async () => {
    routeMeta = { auth: false, authSession: true }
    const session = {
      data: ref(null),
      error: ref(null),
      isPending: ref(false)
    }
    authClientMocks.useSession.mockResolvedValueOnce(session)
    const resolveServerSession = vi.fn().mockResolvedValueOnce(null)

    const authSession = await initializeAuthSession(true, resolveServerSession)
    nuxtApp = { $authSession: authSession }

    await expect(authMiddleware({
      fullPath: '/login',
      meta: { auth: false },
      path: '/login'
    })).resolves.toBeUndefined()

    expect(resolveServerSession).toHaveBeenCalledTimes(1)
    expect(authClientMocks.useSession).not.toHaveBeenCalled()
    expect(nuxtApp.$authSession.data.value).toBeNull()
  })

  it('does not redirect session-fetch failures as signed-out users', async () => {
    const sessionFetchError = {
      message: 'D1 unavailable',
      status: 500,
      statusText: 'Internal Server Error'
    }
    const resolveServerSession = vi.fn().mockRejectedValueOnce(sessionFetchError)

    const authSession = await initializeAuthSession(true, resolveServerSession)
    nuxtApp = { $authSession: authSession }

    await expect(authMiddleware({
      fullPath: '/library',
      meta: {},
      path: '/library'
    })).rejects.toEqual({
      statusCode: 503,
      statusMessage: 'Unable to verify authentication'
    })

    expect(authSession.error.value).toEqual(sessionFetchError)
    expect(resolveServerSession).toHaveBeenCalledTimes(1)
    expect(navigateTo).not.toHaveBeenCalled()
  })
})
