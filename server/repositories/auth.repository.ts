import { Context, Effect, Layer } from 'effect'
import { and, eq, ne, or } from 'drizzle-orm'
import { user } from 'hub:db:schema'
import { DatabaseError } from './book.repository'

export interface AuthRepositoryInterface {
  getPendingEmail: (userId: string) => Effect.Effect<string | null, DatabaseError>
  getPendingEmailByCurrentEmail: (email: string) => Effect.Effect<string | null, DatabaseError>
  emailIsInUse: (userId: string, email: string) => Effect.Effect<boolean, DatabaseError>
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
          catch: (error) => {
            console.error('auth.getPendingEmail failed:', error)
            return new DatabaseError({
              message: 'Failed to load pending email',
              operation: 'auth.getPendingEmail'
            })
          }
        }),

      getPendingEmailByCurrentEmail: email =>
        Effect.tryPromise({
          try: async () => {
            const [row] = await dbService.db
              .select({ pendingEmail: user.pendingEmail })
              .from(user)
              .where(eq(user.email, email))
              .limit(1)

            return row?.pendingEmail ?? null
          },
          catch: (error) => {
            console.error('auth.getPendingEmailByCurrentEmail failed:', error)
            return new DatabaseError({
              message: 'Failed to load pending email',
              operation: 'auth.getPendingEmailByCurrentEmail'
            })
          }
        }),

      emailIsInUse: (userId, email) =>
        Effect.tryPromise({
          try: async () => {
            const [row] = await dbService.db
              .select({ id: user.id })
              .from(user)
              .where(and(
                ne(user.id, userId),
                or(
                  eq(user.email, email),
                  eq(user.pendingEmail, email)
                )
              ))
              .limit(1)

            return Boolean(row)
          },
          catch: (error) => {
            console.error('auth.emailIsInUse failed:', error)
            return new DatabaseError({
              message: 'Failed to check email availability',
              operation: 'auth.emailIsInUse'
            })
          }
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
          catch: (error) => {
            console.error('auth.setPendingEmail failed:', error)
            return new DatabaseError({
              message: 'Failed to set pending email',
              operation: 'auth.setPendingEmail'
            })
          }
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
          catch: (error) => {
            console.error('auth.clearPendingEmail failed:', error)
            return new DatabaseError({
              message: 'Failed to clear pending email',
              operation: 'auth.clearPendingEmail'
            })
          }
        })
    }
  })
)

export const getPendingEmail = (userId: string) =>
  Effect.flatMap(AuthRepository, repository => repository.getPendingEmail(userId))

export const getPendingEmailByCurrentEmail = (email: string) =>
  Effect.flatMap(AuthRepository, repository => repository.getPendingEmailByCurrentEmail(email))

export const emailIsInUse = (userId: string, email: string) =>
  Effect.flatMap(AuthRepository, repository => repository.emailIsInUse(userId, email))

export const setPendingEmail = (userId: string, pendingEmail: string) =>
  Effect.flatMap(AuthRepository, repository => repository.setPendingEmail(userId, pendingEmail))

export const clearPendingEmail = (userId: string) =>
  Effect.flatMap(AuthRepository, repository => repository.clearPendingEmail(userId))
