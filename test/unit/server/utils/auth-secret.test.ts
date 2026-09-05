import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseUserInput } from 'better-auth/db'

const betterAuthMock = vi.hoisted(() => vi.fn(options => ({ options })))
const authDbMocks = vi.hoisted(() => ({
  select: vi.fn(),
  run: vi.fn()
}))

vi.mock('better-auth/minimal', () => ({
  betterAuth: betterAuthMock
}))

vi.mock('better-auth/adapters/drizzle', () => ({
  drizzleAdapter: vi.fn(() => ({}))
}))

vi.mock('better-auth/plugins', () => ({
  admin: vi.fn(() => ({ id: 'admin' })),
  genericOAuth: vi.fn(() => ({ id: 'generic-oauth' })),
  twoFactor: vi.fn(() => ({ id: 'two-factor' }))
}))

vi.mock('better-auth/plugins/admin/access', () => ({
  defaultAc: {
    newRole: vi.fn(role => role)
  }
}))

vi.mock('@nuxthub/db', () => ({
  db: {
    select: authDbMocks.select,
    run: authDbMocks.run,
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
  getConfigValue: vi.fn((envKey: string) => process.env[envKey]),
  getEmailVerificationConfig: vi.fn(() => ({
    enabled: false,
    provider: 'smtp',
    from: '',
    replyTo: '',
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
    authDbMocks.select.mockReset()
    authDbMocks.run.mockReset()
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

  it('declares Libroo server-owned user fields without admin-owned fields', async () => {
    await loadAuthModule()

    const options = getBetterAuthOptions()

    expect(options.user).toMatchObject({
      additionalFields: {
        pendingEmail: {
          type: 'string',
          required: false,
          input: false,
          returned: false
        },
        termsAcceptedAt: {
          type: 'date',
          required: false,
          input: false,
          returned: false
        }
      }
    })
    expect(options.user.additionalFields.pendingEmail).not.toHaveProperty('fieldName')
    expect(options.user.additionalFields.termsAcceptedAt).not.toHaveProperty('fieldName')
    expect(options.user.additionalFields).not.toHaveProperty('role')
    expect(options.user.additionalFields).not.toHaveProperty('banned')
    expect(options.user.additionalFields).not.toHaveProperty('banReason')
    expect(options.user.additionalFields).not.toHaveProperty('banExpires')
  })

  it('only allows implicit OIDC account linking when the provider is explicitly trusted', async () => {
    process.env.NUXT_PUBLIC_OIDC_ENABLED = 'true'
    process.env.NUXT_OIDC_DISCOVERY_URL = 'https://id.example.com/.well-known/openid-configuration'
    process.env.NUXT_OIDC_CLIENT_ID = 'libroo'
    process.env.NUXT_OIDC_CLIENT_SECRET = 'secret'
    process.env.NUXT_OIDC_TRUST_PROVIDER = 'false'

    await loadAuthModule()
    expect(getBetterAuthOptions().account.accountLinking).toEqual({
      enabled: true,
      allowDifferentEmails: false,
      trustedProviders: [],
      disableImplicitLinking: true
    })

    process.env.NUXT_OIDC_TRUST_PROVIDER = 'true'
    await loadAuthModule()
    expect(getBetterAuthOptions().account.accountLinking).toEqual({
      enabled: true,
      allowDifferentEmails: false,
      trustedProviders: ['oidc'],
      disableImplicitLinking: false
    })
  })

  it('does not let an OIDC callback borrow an email signup invite reservation', async () => {
    process.env.NUXT_PUBLIC_REGISTRATION_ENABLED = 'false'
    authDbMocks.select.mockReturnValueOnce({
      from: vi.fn(() => ({
        limit: vi.fn(async () => [{ id: 'existing-user' }])
      }))
    })

    await loadAuthModule()
    const beforeCreate = getBetterAuthOptions().databaseHooks.user.create.before

    await expect(beforeCreate(
      { email: 'oidc-user@example.com' },
      { path: '/callback/oidc' }
    )).resolves.toBe(false)
    expect(authDbMocks.select).toHaveBeenCalledTimes(1)
  })

  it('allows only one concurrent first-user bootstrap when registration is closed', async () => {
    process.env.NUXT_PUBLIC_REGISTRATION_ENABLED = 'false'
    authDbMocks.select.mockImplementation(() => ({
      from: vi.fn(() => ({
        limit: vi.fn(async () => [])
      }))
    }))
    let claimed = false
    authDbMocks.run.mockImplementation(async () => {
      if (claimed) return { changes: 0 }
      claimed = true
      return { changes: 1 }
    })

    await loadAuthModule()
    const beforeCreate = getBetterAuthOptions().databaseHooks.user.create.before
    const results = await Promise.all([
      beforeCreate({ email: 'first@example.com' }, { path: '/sign-up/email' }),
      beforeCreate({ email: 'second@example.com' }, { path: '/sign-up/email' })
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(authDbMocks.run).toHaveBeenCalledTimes(2)
  })

  it('rejects attempts to set Libroo server-owned fields through signup and profile-update input', async () => {
    await loadAuthModule()

    const options = getBetterAuthOptions()

    expect(() => parseUserInput(options, {
      pendingEmail: 'attacker@example.com'
    }, 'create')).toThrow(/pendingEmail is not allowed to be set/)
    expect(() => parseUserInput(options, {
      termsAcceptedAt: new Date('2026-06-23T11:30:00.000Z')
    }, 'create')).toThrow(/termsAcceptedAt is not allowed to be set/)
    expect(() => parseUserInput(options, {
      pendingEmail: 'attacker@example.com'
    }, 'update')).toThrow(/pendingEmail is not allowed to be set/)
    expect(() => parseUserInput(options, {
      termsAcceptedAt: new Date('2026-06-23T11:30:00.000Z')
    }, 'update')).toThrow(/termsAcceptedAt is not allowed to be set/)
  })
})

function getBetterAuthOptions() {
  const options = betterAuthMock.mock.calls.at(-1)?.[0]

  if (!options) {
    throw new Error('Better Auth was not configured')
  }

  return options
}
