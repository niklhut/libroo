import { Context, Effect, Layer, Data } from 'effect'
import type { H3Event } from 'h3'
import type { User } from 'better-auth/types'
import { isActiveBan } from '~~/shared/utils/auth-status'
import { auth } from '../utils/auth'
import { getEmailVerificationConfig } from '../utils/email-verification-config'

// Error types
export class UnauthorizedError extends Data.TaggedError('UnauthorizedError')<{
  message?: string
}> { }

// Type for the complete session data returned by auth.api.getSession
// Inferred from the actual return type to ensure it stays in sync with Better Auth
export type SessionData = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

// Service interface
export interface AuthServiceInterface {
  getCurrentUser: (event: H3Event) => Effect.Effect<SessionData, UnauthorizedError>
  requireAuth: (event: H3Event) => Effect.Effect<User, UnauthorizedError>
  requireVerifiedAuth: (event: H3Event) => Effect.Effect<User, UnauthorizedError>
  getEmailVerificationStatus: (event: H3Event) => Effect.Effect<{
    enabled: boolean
    email: string
    verified: boolean
  }, UnauthorizedError>
  resendVerificationEmail: (event: H3Event) => Effect.Effect<{ status: boolean }, UnauthorizedError>
}

// Service tag
export class AuthService extends Context.Tag('AuthService')<AuthService, AuthServiceInterface>() { }

// Helper to fetch session from event
const fetchSession = (event: H3Event): Effect.Effect<SessionData, UnauthorizedError> =>
  Effect.gen(function* () {
    const session = yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers: event.headers }),
      catch: () => new UnauthorizedError({ message: 'Failed to get session' })
    })

    if (!session) {
      return yield* Effect.fail(new UnauthorizedError({ message: 'No active session' }))
    }

    if (isActiveBan(session.user)) {
      return yield* Effect.fail(new UnauthorizedError({ message: 'Account is banned' }))
    }

    return session
  })

// Live implementation
export const AuthServiceLive = Layer.succeed(AuthService, {
  getCurrentUser: event =>
    fetchSession(event),

  requireAuth: event =>
    Effect.gen(function* () {
      const sessionData = yield* fetchSession(event)
      return sessionData.user
    }),

  requireVerifiedAuth: event =>
    Effect.gen(function* () {
      const sessionData = yield* fetchSession(event)

      if (getEmailVerificationConfig().enabled && sessionData.user.emailVerified !== true) {
        return yield* Effect.fail(new UnauthorizedError({ message: 'Email verification required' }))
      }

      return sessionData.user
    }),

  getEmailVerificationStatus: event =>
    Effect.gen(function* () {
      const sessionData = yield* fetchSession(event)

      return {
        enabled: getEmailVerificationConfig().enabled,
        email: sessionData.user.email,
        verified: sessionData.user.emailVerified === true
      }
    }),

  resendVerificationEmail: event =>
    Effect.gen(function* () {
      const sessionData = yield* fetchSession(event)
      const config = getEmailVerificationConfig()

      if (!config.enabled) {
        return { status: true }
      }

      if (sessionData.user.emailVerified === true) {
        return { status: true }
      }

      return yield* Effect.tryPromise({
        try: () => auth.api.sendVerificationEmail({
          headers: event.headers,
          body: {
            email: sessionData.user.email,
            callbackURL: '/verify-email'
          }
        }),
        catch: () => new UnauthorizedError({ message: 'Unable to send verification email' })
      })
    })
})

// Helper effects
export const getCurrentUser = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.getCurrentUser(event))

export const requireAuth = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.requireAuth(event))

export const requireVerifiedAuth = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.requireVerifiedAuth(event))

export const getEmailVerificationStatus = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.getEmailVerificationStatus(event))

export const resendVerificationEmail = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.resendVerificationEmail(event))
