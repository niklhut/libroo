import { Context, Effect, Layer, Data } from 'effect'
import type { H3Event } from 'h3'
import { auth } from '../utils/auth'

// Error types
export class UnauthorizedError extends Data.TaggedError('UnauthorizedError')<{
  message?: string
}> { }

// User type from Better Auth session
export interface AuthUser {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string | null
  createdAt: Date
  updatedAt: Date
}

export interface Session {
  user: AuthUser
  session: {
    id: string
    expiresAt: Date
    token: string
    userId: string
  }
}

// Service interface
export interface AuthServiceInterface {
  getCurrentUser: (event: H3Event) => Effect.Effect<Session, UnauthorizedError>
  requireAuth: (event: H3Event) => Effect.Effect<AuthUser, UnauthorizedError>
}

// Service tag
export class AuthService extends Context.Tag('AuthService')<AuthService, AuthServiceInterface>() { }

// Live implementation
export const AuthServiceLive = Layer.succeed(AuthService, {
  getCurrentUser: event =>
    Effect.gen(function* () {
      const session = yield* Effect.tryPromise({
        try: () => auth.api.getSession({ headers: event.headers }),
        catch: () => new UnauthorizedError({ message: 'Failed to get session' })
      })

      if (!session) {
        return yield* Effect.fail(new UnauthorizedError({ message: 'No active session' }))
      }

      return session as Session
    }),

  requireAuth: event =>
    Effect.gen(function* () {
      const session = yield* Effect.tryPromise({
        try: () => auth.api.getSession({ headers: event.headers }),
        catch: () => new UnauthorizedError({ message: 'Authentication failed' })
      })

      if (!session) {
        return yield* Effect.fail(new UnauthorizedError({ message: 'Authentication required' }))
      }

      return session.user as AuthUser
    })
})

// Helper effects
export const getCurrentUser = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.getCurrentUser(event))

export const requireAuth = (event: H3Event) =>
  Effect.flatMap(AuthService, service => service.requireAuth(event))
