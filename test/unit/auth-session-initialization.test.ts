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

vi.mock('~/composables/useAuth', () => ({
  useAuth: vi.fn(() => ({
    signOut: authClientMocks.signOut,
    useSession: authClientMocks.useSession
  }))
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
  navigateTo: globalThis.navigateTo,
  useEmailCapabilities: globalThis.useEmailCapabilities,
  useFetch: globalThis.useFetch,
  useNuxtApp: globalThis.useNuxtApp,
  useRoute: globalThis.useRoute
}

let authPlugin: () => Promise<PluginResult>
let authMiddleware: RouteMiddleware
let routeMeta: { auth?: boolean, authSession?: boolean }
let nuxtApp: { $authSession: PluginResult['provide']['authSession'] }
const navigateTo = vi.fn()

beforeAll(async () => {
  vi.stubGlobal('defineNuxtPlugin', (plugin: () => Promise<PluginResult>) => plugin)
  vi.stubGlobal('defineNuxtRouteMiddleware', (middleware: RouteMiddleware) => middleware)
  vi.stubGlobal('navigateTo', navigateTo)
  vi.stubGlobal('useEmailCapabilities', () => ({
    data: ref({ emailVerificationEnabled: true }),
    error: ref(null)
  }))
  vi.stubGlobal('useFetch', vi.fn())
  vi.stubGlobal('useRoute', () => ({ meta: routeMeta }))
  vi.stubGlobal('useNuxtApp', () => nuxtApp)

  authPlugin = (await import('../../app/plugins/auth')).default as unknown as typeof authPlugin
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

    const pluginResult = await authPlugin()
    nuxtApp = { $authSession: pluginResult.provide.authSession }

    await expect(authMiddleware({
      fullPath: '/library',
      meta: {},
      path: '/library'
    })).resolves.toBeUndefined()

    expect(authClientMocks.useSession).toHaveBeenCalledTimes(1)
    expect(nuxtApp.$authSession).toBe(session)
    expect(navigateTo).not.toHaveBeenCalled()
  })

  it('skips server initialization for public routes that do not need auth state', async () => {
    routeMeta = { auth: false }

    const pluginResult = await authPlugin()

    expect(authClientMocks.useSession).not.toHaveBeenCalled()
    expect(pluginResult.provide.authSession.data.value).toBeNull()
    expect(pluginResult.provide.authSession.isPending.value).toBe(false)
  })

  it('initializes auth-aware public routes without making middleware fetch again', async () => {
    routeMeta = { auth: false, authSession: true }
    const session = {
      data: ref(null),
      error: ref(null),
      isPending: ref(false)
    }
    authClientMocks.useSession.mockResolvedValueOnce(session)

    const pluginResult = await authPlugin()
    nuxtApp = { $authSession: pluginResult.provide.authSession }

    await expect(authMiddleware({
      fullPath: '/login',
      meta: { auth: false },
      path: '/login'
    })).resolves.toBeUndefined()

    expect(authClientMocks.useSession).toHaveBeenCalledTimes(1)
    expect(nuxtApp.$authSession).toBe(session)
  })
})
