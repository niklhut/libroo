import { Context, Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { user } from 'hub:db:schema'
import { DatabaseError } from './book.repository'

export interface AuthRepositoryInterface {
  getPendingEmail: (userId: string) => Effect.Effect<string | null, DatabaseError>
  setPendingEmail: (userId: string, pendingEmail: string) => Effect.Effect<void, DatabaseError>
  clearPendingEmail: (userId: string) => Effect.Effect<void, DatabaseError>
}

export class AuthRepository extends Context.Tag('AuthRepository')<AuthRepository, AuthRepositoryInterface>() { }

export const AuthRepositoryLive = Layer.effect(
  AuthRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      getPendingEmail: userId =>
        Effect.tryPromise({
          try: async () => {
            const [row] = await dbService.db
              .select({ pendingEmail: user.pendingEmail })
              .from(user)
              .where(eq(user.id, userId))
              .limit(1)

            return row?.pendingEmail ?? null
          },
          catch: error => new DatabaseError({
            message: `Failed to load pending email: ${error}`,
            operation: 'auth.getPendingEmail'
          })
        }),

      setPendingEmail: (userId, pendingEmail) =>
        Effect.tryPromise({
          try: async () => {
            await dbService.db
              .update(user)
              .set({
                pendingEmail,
                updatedAt: new Date()
              })
              .where(eq(user.id, userId))
          },
          catch: error => new DatabaseError({
            message: `Failed to set pending email: ${error}`,
            operation: 'auth.setPendingEmail'
          })
        }),

      clearPendingEmail: userId =>
        Effect.tryPromise({
          try: async () => {
            await dbService.db
              .update(user)
              .set({
                pendingEmail: null,
                updatedAt: new Date()
              })
              .where(eq(user.id, userId))
          },
          catch: error => new DatabaseError({
            message: `Failed to clear pending email: ${error}`,
            operation: 'auth.clearPendingEmail'
          })
        })
    }
  })
)

export const getPendingEmail = (userId: string) =>
  Effect.flatMap(AuthRepository, repository => repository.getPendingEmail(userId))

export const setPendingEmail = (userId: string, pendingEmail: string) =>
  Effect.flatMap(AuthRepository, repository => repository.setPendingEmail(userId, pendingEmail))

export const clearPendingEmail = (userId: string) =>
  Effect.flatMap(AuthRepository, repository => repository.clearPendingEmail(userId))
