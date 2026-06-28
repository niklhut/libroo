import { Effect } from 'effect'
import { JWTExpired } from 'jose/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthService, AuthServiceLive, UnauthorizedError } from '../../../../server/services/auth.service'
import { AuthRepository } from '../../../../server/repositories/auth.repository'

const envKeys = [
  'NUXT_EMAIL_VERIFICATION_ENABLED',
  'NUXT_EMAIL_FROM',
  'NUXT_SMTP_HOST',
  'NUXT_SMTP_USER',
  'NUXT_SMTP_PASSWORD'
]
const originalEnvValues = new Map(envKeys.map(key => [key, process.env[key]]))

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  sendVerificationEmail: vi.fn(),
  changeEmail: vi.fn(),
  verifyPassword: vi.fn()
}))

const authSessionLoggerMock = vi.hoisted(() => ({
  logAuthSessionResolution: vi.fn()
}))

const jwtMock = vi.hoisted(() => ({
  jwtVerify: vi.fn()
}))

vi.mock('../../../../server/utils/auth', () => ({
  getAuthSecret: () => 'test-secret',
  auth: {
    api: {
      getSession: authMock.getSession,
      sendVerificationEmail: authMock.sendVerificationEmail,
      changeEmail: authMock.changeEmail,
      verifyPassword: authMock.verifyPassword
    }
  }
}))

vi.mock('../../../../server/utils/auth-session-logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../server/utils/auth-session-logger')>()
  return {
    ...actual,
    logAuthSessionResolution: authSessionLoggerMock.logAuthSessionResolution
  }
})

vi.mock('jose', () => ({
  jwtVerify: jwtMock.jwtVerify
}))

describe('AuthService', () => {
  beforeEach(() => {
    authMock.getSession.mockReset()
    authMock.sendVerificationEmail.mockReset()
    authMock.changeEmail.mockReset()
    authMock.verifyPassword.mockReset()
    authSessionLoggerMock.logAuthSessionResolution.mockReset()
    jwtMock.jwtVerify.mockReset()
    authMock.verifyPassword.mockResolvedValue({ status: true })
    authMock.changeEmail.mockResolvedValue({ status: true })
    authRepoMock.getPendingEmail.mockReset()
    authRepoMock.getPendingEmailByCurrentEmail.mockReset()
    authRepoMock.emailIsInUse.mockReset()
    authRepoMock.setPendingEmail.mockReset()
    authRepoMock.clearPendingEmail.mockReset()
    authRepoMock.getPendingEmail.mockReturnValue(Effect.succeed(null))
    authRepoMock.getPendingEmailByCurrentEmail.mockReturnValue(Effect.succeed(null))
    authRepoMock.emailIsInUse.mockReturnValue(Effect.succeed(false))
    authRepoMock.setPendingEmail.mockReturnValue(Effect.void)
    authRepoMock.clearPendingEmail.mockReturnValue(Effect.void)
  })

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnvValues.get(key)
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key)
      } else {
        process.env[key] = value
      }
    }
  })

  it('rejects active banned sessions', async () => {
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        banned: true,
        banExpires: null
      },
      session: { id: 'session-1' }
    })

    const result = await runAuthService(Effect.either(
      Effect.flatMap(AuthService, service => service.requireAuth(makeEvent()))
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(UnauthorizedError)
    expect(result.left).toMatchObject({
      message: 'Account is banned'
    })
  })

  it('logs successful session lookups', async () => {
    const event = makeEvent()
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com'
      },
      session: { id: 'session-1' }
    })

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.requireAuth(event))
    )).resolves.toMatchObject({
      id: 'user-1'
    })

    expect(authSessionLoggerMock.logAuthSessionResolution).toHaveBeenCalledWith({
      event,
      outcome: 'success'
    })
  })

  it('logs unauthenticated session lookups', async () => {
    const event = makeEvent()
    authMock.getSession.mockResolvedValueOnce(null)

    const result = await runAuthService(Effect.either(
      Effect.flatMap(AuthService, service => service.requireAuth(event))
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      message: 'No active session'
    })
    expect(authSessionLoggerMock.logAuthSessionResolution).toHaveBeenCalledWith({
      event,
      outcome: 'unauthenticated'
    })
  })

  it('logs failed session lookups without changing auth errors', async () => {
    const event = makeEvent()
    const error = new Error('database offline')
    authMock.getSession.mockRejectedValueOnce(error)

    const result = await runAuthService(Effect.either(
      Effect.flatMap(AuthService, service => service.requireAuth(event))
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      message: 'Failed to get session'
    })
    expect(authSessionLoggerMock.logAuthSessionResolution).toHaveBeenCalledWith({
      event,
      outcome: 'failure',
      error
    })
  })

  it('allows sessions with expired bans', async () => {
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        banned: true,
        banExpires: new Date('2020-01-01T00:00:00.000Z')
      },
      session: { id: 'session-1' }
    })

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.requireAuth(makeEvent()))
    )).resolves.toMatchObject({
      id: 'user-1'
    })
  })

  it('returns null optional user id when no active session exists', async () => {
    authMock.getSession.mockResolvedValueOnce(null)

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.getOptionalCurrentUserId(makeEvent()))
    )).resolves.toBeNull()
  })

  it('returns optional user id for active sessions', async () => {
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com'
      },
      session: { id: 'session-1' }
    })

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.getOptionalCurrentUserId(makeEvent()))
    )).resolves.toBe('user-1')
  })

  it('allows unverified users when email verification is disabled', async () => {
    process.env.NUXT_EMAIL_VERIFICATION_ENABLED = 'false'
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: false
      },
      session: { id: 'session-1' }
    })

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.requireVerifiedAuth(makeEvent()))
    )).resolves.toMatchObject({
      id: 'user-1'
    })
  })

  it('requires verified users when email verification is enabled', async () => {
    enableVerificationEmail()
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: false
      },
      session: { id: 'session-1' }
    })

    const result = await runAuthService(Effect.either(
      Effect.flatMap(AuthService, service => service.requireVerifiedAuth(makeEvent()))
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      message: 'Email verification required'
    })
  })

  it('resends verification email for unverified users', async () => {
    enableVerificationEmail()
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: false
      },
      session: { id: 'session-1' }
    })
    authMock.sendVerificationEmail.mockResolvedValueOnce({ status: true })

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.resendVerificationEmail(makeEvent()))
    )).resolves.toEqual({ status: true })

    expect(authMock.sendVerificationEmail).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        email: 'ada@example.com',
        callbackURL: '/verify-email'
      }
    })
  })

  it('resends pending email-change verification to the pending inbox', async () => {
    enableVerificationEmail()
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: true
      },
      session: { id: 'session-1' }
    })
    authMock.changeEmail.mockResolvedValueOnce({ status: true })

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.resendVerificationEmail(makeEvent({
        pendingEmail: 'ada.new@example.com'
      })))
    )).resolves.toEqual({ status: true })

    expect(authMock.verifyPassword).not.toHaveBeenCalled()
    expect(authMock.changeEmail).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        newEmail: 'ada.new@example.com',
        callbackURL: '/verify-email'
      }
    })
    expect(authMock.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('surfaces resend delivery failures as non-auth errors', async () => {
    enableVerificationEmail()
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: false
      },
      session: { id: 'session-1' }
    })
    authMock.sendVerificationEmail.mockRejectedValueOnce(new Error('transport failed'))

    const result = await runAuthService(Effect.either(
      Effect.flatMap(AuthService, service => service.resendVerificationEmail(makeEvent()))
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      _tag: 'VerificationEmailDeliveryError',
      message: 'Unable to send verification email'
    })
  })

  it('persists pending email changes in the account repository', async () => {
    enableVerificationEmail()
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: true
      },
      session: { id: 'session-1' }
    })

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.setPendingEmailChange(makeEvent(), 'Ada.New@example.com', 'current-password'))
    )).resolves.toEqual({ pendingEmail: 'ada.new@example.com' })

    expect(authMock.verifyPassword).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        password: 'current-password'
      }
    })
    expect(authRepoMock.emailIsInUse).toHaveBeenCalledWith('user-1', 'ada.new@example.com')
    expect(authRepoMock.setPendingEmail).toHaveBeenCalledWith('user-1', 'ada.new@example.com')
    expect(authMock.changeEmail).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        newEmail: 'ada.new@example.com',
        callbackURL: '/verify-email'
      }
    })
  })

  it('replaces an existing pending email change', async () => {
    enableVerificationEmail()
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: true
      },
      session: { id: 'session-1' }
    })
    authRepoMock.getPendingEmail.mockReturnValueOnce(Effect.succeed('ada.pending@example.com'))

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.setPendingEmailChange(makeEvent(), 'ada.new@example.com', 'current-password'))
    )).resolves.toEqual({ pendingEmail: 'ada.new@example.com' })

    expect(authRepoMock.setPendingEmail).toHaveBeenCalledWith('user-1', 'ada.new@example.com')
    expect(authMock.changeEmail).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        newEmail: 'ada.new@example.com',
        callbackURL: '/verify-email'
      }
    })
  })

  it('rejects pending email changes without the current password', async () => {
    enableVerificationEmail()
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: true
      },
      session: { id: 'session-1' }
    })

    const result = await runAuthService(Effect.either(
      Effect.flatMap(AuthService, service => service.setPendingEmailChange(makeEvent(), 'ada.new@example.com', ''))
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      _tag: 'UnauthorizedError',
      message: 'Current password is required'
    })
    expect(authRepoMock.setPendingEmail).not.toHaveBeenCalled()
  })

  it('rejects pending email changes that conflict with another account email', async () => {
    enableVerificationEmail()
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: true
      },
      session: { id: 'session-1' }
    })
    authRepoMock.emailIsInUse.mockReturnValueOnce(Effect.succeed(true))

    const result = await runAuthService(Effect.either(
      Effect.flatMap(AuthService, service => service.setPendingEmailChange(makeEvent(), 'taken@example.com', 'current-password'))
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      _tag: 'PendingEmailConflictError',
      message: 'Email is already in use'
    })
    expect(authRepoMock.setPendingEmail).not.toHaveBeenCalled()
  })

  it('rejects pending email verification flow when email-change verification is disabled', async () => {
    process.env.NUXT_EMAIL_VERIFICATION_ENABLED = 'false'
    authMock.getSession.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: true
      },
      session: { id: 'session-1' }
    })

    const result = await runAuthService(Effect.either(
      Effect.flatMap(AuthService, service => service.setPendingEmailChange(makeEvent(), 'ada.new@example.com', 'current-password'))
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      _tag: 'EmailCapabilityDisabledError',
      message: 'Email-change verification is not enabled. Change email with current password instead.'
    })
    expect(authRepoMock.setPendingEmail).not.toHaveBeenCalled()
    expect(authMock.changeEmail).not.toHaveBeenCalled()
  })

  it('accepts normal email verification tokens without a pending email lookup', async () => {
    jwtMock.jwtVerify.mockResolvedValueOnce({
      payload: {
        email: 'ada@example.com'
      }
    })

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.validateEmailVerificationToken('token'))
    )).resolves.toEqual({ status: true })

    expect(authRepoMock.getPendingEmailByCurrentEmail).not.toHaveBeenCalled()
  })

  it('accepts email-change verification tokens that match the current pending email', async () => {
    jwtMock.jwtVerify.mockResolvedValueOnce({
      payload: {
        email: 'ADA@Example.com',
        updateTo: 'ada.new@example.com'
      }
    })
    authRepoMock.getPendingEmailByCurrentEmail.mockReturnValueOnce(Effect.succeed('ada.new@example.com'))

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.validateEmailVerificationToken('token'))
    )).resolves.toEqual({ status: true })

    expect(authRepoMock.getPendingEmailByCurrentEmail).toHaveBeenCalledWith('ada@example.com')
  })

  it('validates pending email-change tokens through AuthRepository instead of session-returned user fields', async () => {
    jwtMock.jwtVerify.mockResolvedValueOnce({
      payload: {
        email: 'ada@example.com',
        updateTo: 'ada.new@example.com'
      }
    })
    authRepoMock.getPendingEmailByCurrentEmail.mockReturnValueOnce(Effect.succeed('ADA.NEW@example.com'))

    await expect(runAuthService(
      Effect.flatMap(AuthService, service => service.validateEmailVerificationToken('token'))
    )).resolves.toEqual({ status: true })

    expect(authMock.getSession).not.toHaveBeenCalled()
    expect(authRepoMock.getPendingEmailByCurrentEmail).toHaveBeenCalledWith('ada@example.com')
  })

  it('rejects stale email-change verification tokens', async () => {
    jwtMock.jwtVerify.mockResolvedValueOnce({
      payload: {
        email: 'ada@example.com',
        updateTo: 'ada.old@example.com'
      }
    })
    authRepoMock.getPendingEmailByCurrentEmail.mockReturnValueOnce(Effect.succeed('ada.new@example.com'))

    const result = await runAuthService(Effect.either(
      Effect.flatMap(AuthService, service => service.validateEmailVerificationToken('token'))
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      _tag: 'InvalidEmailVerificationTokenError',
      message: 'This email change link is no longer active. Request a new verification email from settings.'
    })
  })

  it('preserves expired email verification token errors', async () => {
    jwtMock.jwtVerify.mockRejectedValueOnce(new JWTExpired('expired', {
      claim: 'exp',
      reason: 'check_failed',
      payload: {},
      value: new Date()
    }))

    const result = await runAuthService(Effect.either(
      Effect.flatMap(AuthService, service => service.validateEmailVerificationToken('token'))
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      _tag: 'ExpiredEmailVerificationTokenError',
      message: 'TOKEN_EXPIRED'
    })
  })
})

const authRepoMock = {
  getPendingEmail: vi.fn(),
  getPendingEmailByCurrentEmail: vi.fn(),
  emailIsInUse: vi.fn(),
  setPendingEmail: vi.fn(),
  clearPendingEmail: vi.fn()
}

function runAuthService<A, E>(effect: Effect.Effect<A, E, AuthService | AuthRepository>) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(AuthServiceLive),
    Effect.provideService(AuthRepository, authRepoMock)
  ))
}

function makeEvent(options: { pendingEmail?: string } = {}) {
  if (options.pendingEmail) {
    authRepoMock.getPendingEmail.mockReturnValue(Effect.succeed(options.pendingEmail))
  }

  return {
    headers: new Headers(),
    responseHeaders: {}
  } as never
}

function enableVerificationEmail() {
  process.env.NUXT_EMAIL_VERIFICATION_ENABLED = 'true'
  process.env.NUXT_EMAIL_FROM = 'Libroo <no-reply@example.com>'
  process.env.NUXT_SMTP_HOST = 'smtp.example.com'
}
