import { Context, Effect, Layer, Data } from 'effect'
import type { H3Event } from 'h3'
import type { User } from 'better-auth/types'
import { auth } from '../utils/auth'

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
    })
})

// Helper effects
export const getCurrentUser = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.getCurrentUser(event))

export const requireAuth = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.requireAuth(event))
