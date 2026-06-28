import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const originalGlobals = {
  defineNuxtRouteMiddleware: globalThis.defineNuxtRouteMiddleware,
  useAuthStore: globalThis.useAuthStore,
  useNuxtApp: globalThis.useNuxtApp,
  useEmailCapabilities: globalThis.useEmailCapabilities,
  navigateTo: globalThis.navigateTo,
  createError: globalThis.createError,
  authClient: globalThis.authClient,
  useFetch: globalThis.useFetch
}

describe('app/middleware/auth.global', () => {
  beforeEach(() => {
    vi.resetModules()
    globalThis.defineNuxtRouteMiddleware = (middleware: unknown) => middleware
    globalThis.useEmailCapabilities = vi.fn(async () => ({
      data: ref({ emailVerificationEnabled: false }),
      error: ref(null)
    }))
    globalThis.navigateTo = vi.fn(value => value)
    globalThis.createError = vi.fn(error => Object.assign(new Error(error.statusMessage), error))
    globalThis.authClient = {
      useSession: vi.fn(),
      signOut: vi.fn()
    }
    globalThis.useFetch = vi.fn()
    globalThis.useNuxtApp = vi.fn(() => ({
      $authSession: {
        data: ref(null)
      }
    }))
  })

  afterEach(() => {
    Object.assign(globalThis, originalGlobals)
    vi.restoreAllMocks()
  })

  it('redirects unauthenticated users from protected routes without calling Better Auth useSession', async () => {
    globalThis.useAuthStore = vi.fn(() => ({
      user: null,
      status: 'unauthenticated'
    }))
    const middleware = await loadMiddleware()

    await expect(middleware(makeRoute('/library'))).resolves.toEqual({
      path: '/login',
      query: { redirect: '/library' }
    })
    expect(globalThis.authClient.useSession).not.toHaveBeenCalled()
    expect(globalThis.navigateTo).toHaveBeenCalledWith({
      path: '/login',
      query: { redirect: '/library' }
    })
  })

  it('lets Nuxt render unmatched routes as 404 errors without auth redirects', async () => {
    globalThis.useAuthStore = vi.fn()
    const middleware = await loadMiddleware()

    await expect(middleware(makeRoute('/asdf', { matched: [] }))).resolves.toBeUndefined()
    expect(globalThis.useAuthStore).not.toHaveBeenCalled()
    expect(globalThis.useEmailCapabilities).not.toHaveBeenCalled()
    expect(globalThis.navigateTo).not.toHaveBeenCalled()
  })

  it('surfaces session restore errors instead of redirecting to login', async () => {
    globalThis.useAuthStore = vi.fn(() => ({
      user: null,
      status: 'error'
    }))
    const middleware = await loadMiddleware()

    await expect(middleware(makeRoute('/library'))).rejects.toMatchObject({
      statusCode: 503,
      statusMessage: 'Unable to restore session'
    })
    expect(globalThis.navigateTo).not.toHaveBeenCalled()
  })

  it('allows authenticated users from injected session state', async () => {
    globalThis.useAuthStore = vi.fn(() => ({
      user: {
        id: 'user-1',
        emailVerified: true,
        role: 'user'
      },
      status: 'authenticated'
    }))
    const middleware = await loadMiddleware()

    await expect(middleware(makeRoute('/library'))).resolves.toBeUndefined()
    expect(globalThis.authClient.useSession).not.toHaveBeenCalled()
    expect(globalThis.navigateTo).not.toHaveBeenCalled()
  })

  it('preserves the admin role guard', async () => {
    globalThis.useAuthStore = vi.fn(() => ({
      user: {
        id: 'user-1',
        emailVerified: true,
        role: 'user'
      },
      status: 'authenticated'
    }))
    const middleware = await loadMiddleware()

    await expect(middleware(makeRoute('/admin/users'))).resolves.toBe('/library')
    expect(globalThis.navigateTo).toHaveBeenCalledWith('/library')
  })
})

async function loadMiddleware() {
  const module = await import('../../app/middleware/auth.global')
  return module.default as (to: ReturnType<typeof makeRoute>) => Promise<unknown>
}

function makeRoute(path: string, overrides: Partial<{ matched: unknown[] }> = {}) {
  return {
    path,
    fullPath: path,
    meta: {},
    matched: [{}],
    ...overrides
  }
}
