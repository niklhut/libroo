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
  getCurrentUser: (event) =>
    Effect.tryPromise({
      try: async () => {
        const session = await auth.api.getSession({
          headers: event.headers
        })

        if (!session) {
          throw new UnauthorizedError({ message: 'No active session' })
        }

        return session as Session
      },
      catch: (error) => {
        if (error instanceof UnauthorizedError) {
          return error
        }
        return new UnauthorizedError({ message: 'Failed to get session' })
      }
    }),

  requireAuth: (event) =>
    Effect.flatMap(
      Effect.tryPromise({
        try: async () => {
          const session = await auth.api.getSession({
            headers: event.headers
          })

          if (!session) {
            throw new UnauthorizedError({ message: 'Authentication required' })
          }

          return session.user as AuthUser
        },
        catch: (error) => {
          if (error instanceof UnauthorizedError) {
            return error
          }
          return new UnauthorizedError({ message: 'Authentication failed' })
        }
      }),
      (user) => Effect.succeed(user)
    )
})

// Helper effects
export const getCurrentUser = (event: H3Event) =>
  Effect.flatMap(AuthService, (service) => service.getCurrentUser(event))

export const requireAuth = (event: H3Event) =>
  Effect.flatMap(AuthService, (service) => service.requireAuth(event))
