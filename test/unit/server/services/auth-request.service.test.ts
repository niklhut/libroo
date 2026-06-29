import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthRepository } from '../../../../server/repositories/auth.repository'
import { DatabaseError } from '../../../../server/repositories/book.repository'
import { AuthRequestService, AuthRequestServiceLive, EmailChangeNotAllowedError, PasswordResetUnavailableError } from '../../../../server/services/auth-request.service'
import { AuthService } from '../../../../server/services/auth.service'
import { DbService } from '../../../../server/services/db.service'
import { SignupInviteService } from '../../../../server/services/signup-invite.service'

const authMock = vi.hoisted(() => ({
  handler: vi.fn()
}))

const emailCapabilitiesMock = vi.hoisted(() => ({
  getEmailCapabilities: vi.fn()
}))

const emailVerificationConfigMock = vi.hoisted(() => ({
  getEmailVerificationConfig: vi.fn()
}))

vi.mock('../../../../server/utils/auth', () => ({
  auth: {
    handler: authMock.handler
  }
}))

vi.mock('../../../../server/utils/email-capabilities', () => ({
  getEmailCapabilities: emailCapabilitiesMock.getEmailCapabilities
}))

vi.mock('../../../../server/utils/email-verification-config', () => ({
  getEmailVerificationConfig: emailVerificationConfigMock.getEmailVerificationConfig
}))

describe('AuthRequestService', () => {
  beforeEach(() => {
    authMock.handler.mockReset()
    emailCapabilitiesMock.getEmailCapabilities.mockReset()
    emailVerificationConfigMock.getEmailVerificationConfig.mockReset()
    signupInviteServiceMock.reserveSignupAttempt.mockReset()
    signupInviteServiceMock.acceptInvite.mockReset()
    signupInviteServiceMock.releaseInviteReservation.mockReset()
    authServiceMock.validateEmailVerificationToken.mockReset()

    emailCapabilitiesMock.getEmailCapabilities.mockReturnValue({
      passwordResetEnabled: true
    })
    emailVerificationConfigMock.getEmailVerificationConfig.mockReturnValue({
      enabled: false
    })
    signupInviteServiceMock.reserveSignupAttempt.mockReturnValue(Effect.succeed({ reservationToken: 'reservation-1' }))
    signupInviteServiceMock.acceptInvite.mockReturnValue(Effect.succeed({ id: 'invite-1' }))
    signupInviteServiceMock.releaseInviteReservation.mockReturnValue(Effect.void)
    authServiceMock.validateEmailVerificationToken.mockReturnValue(Effect.succeed({ status: true }))
  })

  it('accepts a successful invited signup', async () => {
    const response = Response.json({ user: { id: 'user-1' } })
    authMock.handler.mockResolvedValueOnce(response)

    await expect(runAuthRequestService(handle(makeSignupRequest()))).resolves.toBe(response)

    expect(signupInviteServiceMock.reserveSignupAttempt).toHaveBeenCalledWith({
      token: 'invite-token',
      email: 'ada@example.com'
    })
    expect(signupInviteServiceMock.acceptInvite).toHaveBeenCalledTimes(1)
    expect(signupInviteServiceMock.acceptInvite).toHaveBeenCalledWith('reservation-1', 'user-1')
    expect(signupInviteServiceMock.releaseInviteReservation).not.toHaveBeenCalled()
  })

  it('releases the reservation and re-raises when Better Auth throws', async () => {
    const error = new Error('auth failed')
    authMock.handler.mockRejectedValueOnce(error)

    const result = await runAuthRequestService(Effect.either(handle(makeSignupRequest())))

    expect(result._tag).toBe('Left')
    expect(result.left).toBe(error)
    expect(signupInviteServiceMock.releaseInviteReservation).toHaveBeenCalledWith('reservation-1')
    expect(signupInviteServiceMock.acceptInvite).not.toHaveBeenCalled()
  })

  it('releases the reservation on a non-ok response', async () => {
    const response = Response.json({ message: 'invalid' }, { status: 400 })
    authMock.handler.mockResolvedValueOnce(response)

    await expect(runAuthRequestService(handle(makeSignupRequest()))).resolves.toBe(response)

    expect(signupInviteServiceMock.releaseInviteReservation).toHaveBeenCalledWith('reservation-1')
    expect(signupInviteServiceMock.acceptInvite).not.toHaveBeenCalled()
  })

  it('releases the reservation when an ok response has no user id', async () => {
    const response = Response.json({ user: {} })
    authMock.handler.mockResolvedValueOnce(response)

    await expect(runAuthRequestService(handle(makeSignupRequest()))).resolves.toBe(response)

    expect(signupInviteServiceMock.releaseInviteReservation).toHaveBeenCalledWith('reservation-1')
    expect(signupInviteServiceMock.acceptInvite).not.toHaveBeenCalled()
  })

  it('releases the reservation and re-raises when accepting the invite fails', async () => {
    const response = Response.json({ user: { id: 'user-1' } })
    const error = new DatabaseError({
      message: 'accept failed',
      operation: 'signupInvite.acceptInvite'
    })
    authMock.handler.mockResolvedValueOnce(response)
    signupInviteServiceMock.acceptInvite.mockReturnValueOnce(Effect.fail(error))

    const result = await runAuthRequestService(Effect.either(handle(makeSignupRequest())))

    expect(result._tag).toBe('Left')
    expect(result.left).toBe(error)
    expect(signupInviteServiceMock.acceptInvite).toHaveBeenCalledWith('reservation-1', 'user-1')
    expect(signupInviteServiceMock.releaseInviteReservation).toHaveBeenCalledWith('reservation-1')
  })

  it('swallows release failures without masking the original result', async () => {
    const response = Response.json({ message: 'invalid' }, { status: 400 })
    authMock.handler.mockResolvedValueOnce(response)
    signupInviteServiceMock.releaseInviteReservation.mockReturnValueOnce(Effect.fail(new DatabaseError({
      message: 'cleanup failed',
      operation: 'signupInvite.releaseReservation'
    })))

    await expect(runAuthRequestService(handle(makeSignupRequest()))).resolves.toBe(response)
  })

  it('yields PasswordResetUnavailableError when password reset is disabled', async () => {
    emailCapabilitiesMock.getEmailCapabilities.mockReturnValueOnce({
      passwordResetEnabled: false
    })

    const result = await runAuthRequestService(Effect.either(handle(new Request('http://localhost/api/auth/request-password-reset', {
      method: 'POST'
    }))))

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(PasswordResetUnavailableError)
    expect(result.left).toMatchObject({
      message: 'Password reset email is not available for this deployment. Contact the administrator to reset your password.'
    })
    expect(authMock.handler).not.toHaveBeenCalled()
  })

  it('yields EmailChangeNotAllowedError when email verification owns email changes', async () => {
    emailVerificationConfigMock.getEmailVerificationConfig.mockReturnValueOnce({
      enabled: true
    })

    const result = await runAuthRequestService(Effect.either(handle(new Request('http://localhost/api/auth/change-email'))))

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(EmailChangeNotAllowedError)
    expect(result.left).toMatchObject({
      message: 'Use account settings to change email'
    })
    expect(authMock.handler).not.toHaveBeenCalled()
  })

  it('pre-validates verify-email tokens', async () => {
    const response = new Response(null, { status: 204 })
    emailVerificationConfigMock.getEmailVerificationConfig.mockReturnValueOnce({
      enabled: true
    })
    authMock.handler.mockResolvedValueOnce(response)

    await expect(runAuthRequestService(handle(new Request('http://localhost/api/auth/verify-email?token=token-1')))).resolves.toBe(response)

    expect(authServiceMock.validateEmailVerificationToken).toHaveBeenCalledWith('token-1')
  })
})

const signupInviteServiceMock = {
  createInvite: vi.fn(),
  listInvites: vi.fn(),
  revokeInvite: vi.fn(),
  getInvitePreview: vi.fn(),
  validateSignupAttempt: vi.fn(),
  reserveSignupAttempt: vi.fn(),
  acceptInvite: vi.fn(),
  releaseInviteReservation: vi.fn()
}

const authServiceMock = {
  getCurrentUser: vi.fn(),
  getOptionalCurrentUserId: vi.fn(),
  requireAuth: vi.fn(),
  requireVerifiedAuth: vi.fn(),
  getEmailVerificationStatus: vi.fn(),
  setPendingEmailChange: vi.fn(),
  clearPendingEmailChange: vi.fn(),
  resendVerificationEmail: vi.fn(),
  validateEmailVerificationToken: vi.fn()
}

function handle(request: Request) {
  return Effect.flatMap(AuthRequestService, service => service.handleAuthRequest(request))
}

function runAuthRequestService<A, E>(effect: Effect.Effect<A, E, AuthRequestService | AuthRepository | DbService>) {
  const dependencies = Layer.mergeAll(
    Layer.succeed(SignupInviteService, signupInviteServiceMock),
    Layer.succeed(AuthService, authServiceMock),
    Layer.succeed(AuthRepository, {} as never),
    Layer.succeed(DbService, {} as never)
  )

  return Effect.runPromise(effect.pipe(
    Effect.provide(AuthRequestServiceLive),
    Effect.provide(dependencies)
  ))
}

function makeSignupRequest() {
  return new Request('http://localhost/api/auth/sign-up/email', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      inviteToken: 'invite-token',
      email: 'ada@example.com'
    })
  })
}
