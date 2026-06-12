import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthService, AuthServiceLive, UnauthorizedError } from '../../../../server/services/auth.service'

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  sendVerificationEmail: vi.fn()
}))

vi.mock('../../../../server/utils/auth', () => ({
  auth: {
    api: {
      getSession: authMock.getSession,
      sendVerificationEmail: authMock.sendVerificationEmail
    }
  }
}))

describe('AuthService', () => {
  beforeEach(() => {
    authMock.getSession.mockReset()
    authMock.sendVerificationEmail.mockReset()
  })

  afterEach(() => {
    delete process.env.LIBROO_EMAIL_VERIFICATION_ENABLED
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

  it('allows unverified users when email verification is disabled', async () => {
    process.env.LIBROO_EMAIL_VERIFICATION_ENABLED = 'false'
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
    process.env.LIBROO_EMAIL_VERIFICATION_ENABLED = 'true'
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
    process.env.LIBROO_EMAIL_VERIFICATION_ENABLED = 'true'
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
})

function runAuthService<A, E>(effect: Effect.Effect<A, E, AuthService>) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(AuthServiceLive)
  ))
}

function makeEvent() {
  return {
    headers: new Headers()
  } as never
}
