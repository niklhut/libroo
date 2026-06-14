import { afterEach, describe, expect, it, vi } from 'vitest'

const betterAuthMock = vi.hoisted(() => vi.fn(options => ({ options })))

vi.mock('better-auth', () => ({
  betterAuth: betterAuthMock
}))

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({}))
}))

vi.mock('better-auth/plugins', () => ({
  admin: vi.fn(() => ({ id: 'admin' }))
}))

vi.mock('better-auth/plugins/admin/access', () => ({
  defaultAc: {
    newRole: vi.fn(role => role)
  }
}))

vi.mock('@nuxthub/db', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn()
      }))
    }))
  }
}))

vi.mock('@nuxthub/db/schema', () => ({
  user: {
    id: 'id'
  }
}))

vi.mock('../../../../server/utils/email-verification-config', () => ({
  getEmailVerificationConfig: vi.fn(() => ({
    enabled: false,
    provider: 'smtp',
    from: '',
    smtp: null,
    plunk: null
  })),
  validateEmailVerificationConfig: vi.fn()
}))

vi.mock('../../../../server/services/email.service', () => ({
  sendEmailMessage: vi.fn()
}))

vi.mock('../../../../server/utils/libroo-admin-auth-plugin', () => ({
  librooAdminPolicyPlugin: vi.fn(() => ({ id: 'libroo-admin-policy' }))
}))

vi.mock('../../../../server/utils/libroo-admin-audit-plugin', () => ({
  librooAdminAuditPlugin: vi.fn(() => ({ id: 'libroo-admin-audit' }))
}))

vi.mock('../../../../server/utils/libroo-security-notification-plugin', () => ({
  librooSecurityNotificationPlugin: vi.fn(() => ({ id: 'libroo-security-notification' }))
}))

const originalEnv = { ...process.env }

async function loadAuthModule() {
  vi.resetModules()
  betterAuthMock.mockClear()
  return import('../../../../server/utils/auth')
}

describe('auth secret runtime config', () => {
  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
  })

  it('passes NUXT_BETTER_AUTH_SECRET directly to Better Auth', async () => {
    process.env.NUXT_BETTER_AUTH_SECRET = 'direct-env-secret-that-is-long-enough'

    const { getAuthSecret } = await loadAuthModule()

    expect(getAuthSecret()).toBe('direct-env-secret-that-is-long-enough')
    expect(betterAuthMock).toHaveBeenCalledWith(expect.objectContaining({
      secret: 'direct-env-secret-that-is-long-enough'
    }))
  })

  it('uses Nuxt runtime config when available', async () => {
    process.env.NUXT_BETTER_AUTH_SECRET = ''
    vi.stubGlobal('useRuntimeConfig', () => ({
      betterAuthSecret: 'runtime-secret-that-is-long-enough',
      betterAuthUrl: 'https://libroo.example.com'
    }))

    const { getAuthSecret } = await loadAuthModule()

    expect(getAuthSecret()).toBe('runtime-secret-that-is-long-enough')
    expect(betterAuthMock).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://libroo.example.com',
      secret: 'runtime-secret-that-is-long-enough'
    }))
  })

  it('throws in production instead of silently using the dev secret', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.NUXT_BETTER_AUTH_SECRET

    await expect(loadAuthModule()).rejects.toThrow(/NUXT_BETTER_AUTH_SECRET/)
  })
})
