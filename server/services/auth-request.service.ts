import { Context, Data, Effect, Layer } from 'effect'
import { auth } from '../utils/auth'
import { getEmailCapabilities } from '../utils/email-capabilities'
import { getEmailVerificationConfig } from '../utils/email-verification-config'
import type { AuthRepository } from '../repositories/auth.repository'
import type { DbService } from './db.service'
import { AuthService } from './auth.service'
import { SignupInviteService } from './signup-invite.service'
import type { SignupInviteServiceInterface } from './signup-invite.service'

export class PasswordResetUnavailableError extends Data.TaggedError('PasswordResetUnavailableError')<{
  message: string
}> { }

export class EmailChangeNotAllowedError extends Data.TaggedError('EmailChangeNotAllowedError')<{
  message: string
}> { }

export interface AuthRequestServiceInterface {
  handleAuthRequest: (request: Request) => Effect.Effect<Response, unknown, AuthRepository | DbService>
}

export class AuthRequestService extends Context.Tag('AuthRequestService')<AuthRequestService, AuthRequestServiceInterface>() { }

export const AuthRequestServiceLive = Layer.effect(
  AuthRequestService,
  Effect.gen(function* () {
    const signupInviteService = yield* SignupInviteService
    const authService = yield* AuthService

    return {
      handleAuthRequest: request =>
        Effect.gen(function* () {
          const url = new URL(request.url ?? 'http://localhost/api/auth')
          const verificationEnabled = getEmailVerificationConfig().enabled
          const capabilities = getEmailCapabilities()
          const isEmailSignup = url.pathname.endsWith('/api/auth/sign-up/email') && request.method === 'POST'
          let inviteReservationToken: string | null = null

          if (url.pathname.endsWith('/api/auth/request-password-reset') && request.method === 'POST' && !capabilities.passwordResetEnabled) {
            return yield* Effect.fail(new PasswordResetUnavailableError({
              message: 'Password reset email is not available for this deployment. Contact the administrator to reset your password.'
            }))
          }

          if (verificationEnabled && url.pathname.endsWith('/api/auth/change-email')) {
            return yield* Effect.fail(new EmailChangeNotAllowedError({
              message: 'Use account settings to change email'
            }))
          }

          if (verificationEnabled && url.pathname.endsWith('/api/auth/verify-email')) {
            const token = url.searchParams.get('token')
            if (token) {
              yield* authService.validateEmailVerificationToken(token)
            }
          }

          if (isEmailSignup) {
            const body = yield* Effect.tryPromise({
              try: () => readSignupBody(request),
              catch: error => error
            })
            const reservation = yield* signupInviteService.reserveSignupAttempt({
              token: body?.inviteToken,
              email: body?.email
            })
            inviteReservationToken = reservation.reservationToken
          }

          const response = yield* Effect.tryPromise({
            try: () => auth.handler(request),
            catch: error => error
          }).pipe(
            Effect.catchAll(error =>
              releaseReservation(signupInviteService, inviteReservationToken).pipe(
                Effect.andThen(Effect.fail(error))
              )
            )
          )

          if (isEmailSignup && inviteReservationToken && !response.ok) {
            yield* releaseReservation(signupInviteService, inviteReservationToken)
          }

          if (isEmailSignup && response.ok && inviteReservationToken) {
            const body = yield* Effect.promise(() =>
              response.clone().json().catch(() => null) as Promise<{ user?: { id?: string } } | null>
            )
            const userId = body?.user?.id

            if (userId) {
              yield* signupInviteService.acceptInvite(inviteReservationToken, userId).pipe(
                Effect.catchAll(error =>
                  releaseReservation(signupInviteService, inviteReservationToken).pipe(
                    Effect.andThen(Effect.fail(error))
                  )
                )
              )
            } else {
              yield* releaseReservation(signupInviteService, inviteReservationToken)
            }
          }

          return response
        })
    }
  })
)

export const handleAuthRequest = (request: Request) =>
  Effect.flatMap(AuthRequestService, service => service.handleAuthRequest(request))

async function readSignupBody(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return await request.clone().json().catch(() => null) as Record<string, unknown> | null
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.clone().formData().catch(() => null)
    if (!form) return null

    return Object.fromEntries(form.entries())
  }

  return null
}

function releaseReservation(
  signupInviteService: SignupInviteServiceInterface,
  reservationToken: string | null
) {
  if (!reservationToken) return Effect.void

  return signupInviteService.releaseInviteReservation(reservationToken).pipe(
    Effect.catchAll(() => Effect.void)
  )
}
