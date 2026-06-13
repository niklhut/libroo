import { Context, Effect, Layer, Data } from 'effect'
import type { H3Event } from 'h3'
import type { User } from 'better-auth/types'
import { jwtVerify } from 'jose'
import { JWTExpired } from 'jose/errors'
import * as z from 'zod'
import { isActiveBan } from '~~/shared/utils/auth-status'
import { auth, getAuthSecret } from '../utils/auth'
import { getEmailVerificationConfig } from '../utils/email-verification-config'
import type { AuthRepository } from '../repositories/auth.repository'
import { clearPendingEmail, emailIsInUse, getPendingEmail, getPendingEmailByCurrentEmail, setPendingEmail } from '../repositories/auth.repository'
import type { DatabaseError } from '../repositories/book.repository'

// Error types
export class UnauthorizedError extends Data.TaggedError('UnauthorizedError')<{
  message?: string
}> { }

export class VerificationEmailDeliveryError extends Data.TaggedError('VerificationEmailDeliveryError')<{
  message?: string
}> { }

export class InvalidPendingEmailError extends Data.TaggedError('InvalidPendingEmailError')<{
  message?: string
}> { }

export class PendingEmailConflictError extends Data.TaggedError('PendingEmailConflictError')<{
  message?: string
}> { }

export class InvalidEmailVerificationTokenError extends Data.TaggedError('InvalidEmailVerificationTokenError')<{
  message?: string
}> { }

export class ExpiredEmailVerificationTokenError extends Data.TaggedError('ExpiredEmailVerificationTokenError')<{
  message?: string
}> { }

const pendingEmailSchema = z.email()
const emailVerificationTokenSchema = z.object({
  email: z.email(),
  updateTo: z.email().optional()
})

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
    pendingEmail: string | null
  }, UnauthorizedError | DatabaseError, AuthRepository>
  setPendingEmailChange: (event: H3Event, pendingEmail: string, currentPassword: string) => Effect.Effect<{ pendingEmail: string }, UnauthorizedError | InvalidPendingEmailError | PendingEmailConflictError | VerificationEmailDeliveryError | DatabaseError, AuthRepository>
  clearPendingEmailChange: (event: H3Event) => Effect.Effect<{ status: boolean }, UnauthorizedError | DatabaseError, AuthRepository>
  resendVerificationEmail: (event: H3Event, currentPassword?: string) => Effect.Effect<{ status: boolean }, UnauthorizedError | VerificationEmailDeliveryError | DatabaseError, AuthRepository>
  validateEmailVerificationToken: (token: string) => Effect.Effect<{ status: boolean }, InvalidEmailVerificationTokenError | ExpiredEmailVerificationTokenError | DatabaseError, AuthRepository>
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
      const pendingEmail = yield* getAccountPendingEmail(sessionData.user.id, sessionData.user.email)

      return {
        enabled: getEmailVerificationConfig().enabled,
        email: sessionData.user.email,
        verified: sessionData.user.emailVerified === true,
        pendingEmail
      }
    }),

  setPendingEmailChange: (event, pendingEmail, currentPassword) =>
    Effect.gen(function* () {
      const sessionData = yield* fetchSession(event)
      yield* verifyCurrentPassword(event, currentPassword)
      const parsed = pendingEmailSchema.safeParse(pendingEmail)

      if (!parsed.success) {
        return yield* Effect.fail(new InvalidPendingEmailError({ message: 'Pending email is invalid' }))
      }

      const normalizedPendingEmail = parsed.data.toLowerCase()
      if (normalizedPendingEmail === sessionData.user.email.toLowerCase()) {
        return yield* Effect.fail(new InvalidPendingEmailError({ message: 'Pending email must differ from the current email' }))
      }

      if (yield* emailIsInUse(sessionData.user.id, normalizedPendingEmail)) {
        return yield* Effect.fail(new PendingEmailConflictError({ message: 'Email is already in use' }))
      }

      yield* setPendingEmail(sessionData.user.id, normalizedPendingEmail)
      yield* sendPendingEmailChange(event, normalizedPendingEmail)
      return { pendingEmail: normalizedPendingEmail }
    }),

  clearPendingEmailChange: event =>
    Effect.gen(function* () {
      const sessionData = yield* fetchSession(event)
      yield* clearPendingEmail(sessionData.user.id)
      return { status: true }
    }),

  resendVerificationEmail: event =>
    Effect.gen(function* () {
      const sessionData = yield* fetchSession(event)
      const config = getEmailVerificationConfig()
      const pendingEmail = yield* getAccountPendingEmail(sessionData.user.id, sessionData.user.email)

      if (!config.enabled) {
        return { status: true }
      }

      if (!pendingEmail && sessionData.user.emailVerified === true) {
        return { status: true }
      }

      return pendingEmail
        ? yield* sendPendingEmailChange(event, pendingEmail)
        : yield* sendCurrentEmailVerification(event, sessionData.user.email)
    }),

  validateEmailVerificationToken: token =>
    Effect.gen(function* () {
      const payload = yield* Effect.tryPromise({
        try: async () => {
          const { payload } = await jwtVerify(token, new TextEncoder().encode(getAuthSecret()), {
            algorithms: ['HS256']
          })
          return emailVerificationTokenSchema.parse(payload)
        },
        catch: error => error instanceof JWTExpired
          ? new ExpiredEmailVerificationTokenError({
              message: 'TOKEN_EXPIRED'
            })
          : new InvalidEmailVerificationTokenError({
              message: 'This verification link is invalid.'
            })
      })

      if (!payload.updateTo) {
        return { status: true }
      }

      const pendingEmail = yield* getPendingEmailByCurrentEmail(payload.email.toLowerCase())

      if (pendingEmail?.toLowerCase() !== payload.updateTo.toLowerCase()) {
        return yield* Effect.fail(new InvalidEmailVerificationTokenError({
          message: 'This email change link is no longer active. Request a new verification email from settings.'
        }))
      }

      return { status: true }
    })
})

function verifyCurrentPassword(event: H3Event, currentPassword: string | undefined) {
  if (!currentPassword) {
    return Effect.fail(new UnauthorizedError({ message: 'Current password is required' }))
  }

  return Effect.tryPromise({
    try: () => auth.api.verifyPassword({
      headers: event.headers,
      body: {
        password: currentPassword
      }
    }),
    catch: () => new UnauthorizedError({ message: 'Current password is incorrect' })
  })
}

function sendPendingEmailChange(event: H3Event, pendingEmail: string) {
  return Effect.tryPromise({
    try: () => auth.api.changeEmail({
      headers: event.headers,
      body: {
        newEmail: pendingEmail,
        callbackURL: '/verify-email'
      }
    }),
    catch: () => new VerificationEmailDeliveryError({ message: 'Unable to send verification email' })
  }).pipe(Effect.as({ status: true }))
}

function sendCurrentEmailVerification(event: H3Event, email: string) {
  return Effect.tryPromise({
    try: () => auth.api.sendVerificationEmail({
      headers: event.headers,
      body: {
        email,
        callbackURL: '/verify-email'
      }
    }),
    catch: () => new VerificationEmailDeliveryError({ message: 'Unable to send verification email' })
  }).pipe(Effect.as({ status: true }))
}

function getAccountPendingEmail(userId: string, currentEmail: string) {
  return Effect.gen(function* () {
    const pendingEmail = yield* getPendingEmail(userId)

    if (!pendingEmail || pendingEmail.toLowerCase() === currentEmail.toLowerCase()) {
      if (pendingEmail) {
        yield* clearPendingEmail(userId)
      }
      return null
    }

    return pendingEmail
  })
}

// Helper effects
export const getCurrentUser = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.getCurrentUser(event))

export const requireAuth = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.requireAuth(event))

export const requireVerifiedAuth = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.requireVerifiedAuth(event))

export const getEmailVerificationStatus = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.getEmailVerificationStatus(event))

export const resendVerificationEmail = (event: H3Event, currentPassword?: string) =>
  Effect.flatMap(AuthService, service => service.resendVerificationEmail(event, currentPassword))

export const setPendingEmailChange = (event: H3Event, pendingEmail: string, currentPassword: string) =>
  Effect.flatMap(AuthService, service => service.setPendingEmailChange(event, pendingEmail, currentPassword))

export const clearPendingEmailChange = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.clearPendingEmailChange(event))

export const validateEmailVerificationToken = (token: string) =>
  Effect.flatMap(AuthService, service => service.validateEmailVerificationToken(token))
