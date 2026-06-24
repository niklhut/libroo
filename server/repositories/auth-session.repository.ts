import { Context, Data, Effect, Layer } from 'effect'
import { auth } from '../utils/auth'

export type AuthSessionData = Awaited<ReturnType<typeof auth.api.getSession>>

export class AuthSessionRepositoryError extends Data.TaggedError('AuthSessionRepositoryError')<{
  message: string
  cause?: unknown
  code?: string | number
  status?: number
}> { }

export interface AuthSessionRepositoryInterface {
  getSession: (headers: Headers) => Effect.Effect<AuthSessionData, AuthSessionRepositoryError>
}

export class AuthSessionRepository extends Context.Tag('AuthSessionRepository')<
  AuthSessionRepository,
  AuthSessionRepositoryInterface
>() { }

export const AuthSessionRepositoryLive = Layer.succeed(AuthSessionRepository, {
  getSession: headers =>
    Effect.tryPromise({
      try: () => auth.api.getSession({ headers }),
      catch: error => new AuthSessionRepositoryError({
        message: getErrorField(error, 'message') ?? 'Failed to resolve authentication session',
        cause: getErrorField(error, 'cause'),
        code: getErrorField(error, 'code'),
        status: getErrorField(error, 'status')
      })
    })
})

export const getAuthSession = (headers: Headers) =>
  Effect.flatMap(AuthSessionRepository, repository => repository.getSession(headers))

function getErrorField<T>(error: unknown, field: string): T | undefined {
  if (error && typeof error === 'object' && field in error) {
    return (error as Record<string, unknown>)[field] as T
  }
}
