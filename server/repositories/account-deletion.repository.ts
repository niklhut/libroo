import { Context, Effect, Layer, Data } from 'effect'
import { and, eq, exists, inArray, not, or, sql } from 'drizzle-orm'
import { account, books, locations, loans, session, signupInvites, user, userBookTags, userBooks, verification } from 'hub:db:schema'
import { roleIncludesAdmin } from '~~/shared/utils/auth-roles'
import { isActiveBan } from '~~/shared/utils/auth-status'
import { DatabaseError } from './book.repository'
import { DbService } from '../services/db.service'
import type { AtomicDbStatement } from '../services/db.service'

export class LastAdminAccountDeletionError extends Data.TaggedError('LastAdminAccountDeletionError')<{
  message: string
}> { }

export interface AccountDeletionResult {
  deletedUserId: string
  blobPaths: string[]
  deletedManualBooks: number
  deletedUserBooks: number
  deletedOwnedLoans: number
  anonymizedBorrowedLoans: number
}

export interface AccountDeletionRepositoryInterface {
  deleteAccountData: (userId: string) => Effect.Effect<AccountDeletionResult, LastAdminAccountDeletionError | DatabaseError>
}

export class AccountDeletionRepository extends Context.Tag('AccountDeletionRepository')<AccountDeletionRepository, AccountDeletionRepositoryInterface>() { }

export const AccountDeletionRepositoryLive = Layer.effect(
  AccountDeletionRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      deleteAccountData: userId =>
        Effect.tryPromise({
          try: async () => {
            const [userRow] = await dbService.db
              .select({
                email: user.email,
                pendingEmail: user.pendingEmail,
                image: user.image,
                role: user.role,
                banned: user.banned,
                banExpires: user.banExpires
              })
              .from(user)
              .where(eq(user.id, userId))
              .limit(1)

            if (userRow && roleIncludesAdmin(userRow.role) && !isActiveBan(userRow)) {
              const otherAdminRows = await dbService.db
                .select({ count: sql<number | string | bigint>`count(*)` })
                .from(user)
                .where(sql`
                  ${user.id} <> ${userId}
                  AND ${adminRoleTokenPredicate()}
                  AND ${inactiveBanPredicate()}
                `)

              if (Number(otherAdminRows[0]?.count ?? 0) <= 0) {
                throw new LastAdminAccountDeletionError({
                  message: 'Cannot delete the last remaining active admin account'
                })
              }
            }

            const userBookRows = await dbService.db
              .select({ id: userBooks.id })
              .from(userBooks)
              .where(eq(userBooks.userId, userId))
            const userBookIds = userBookRows.map(row => row.id)
            const verificationIdentifiers = [userRow?.email, userRow?.pendingEmail]
              .filter((value): value is string => Boolean(value))
            const now = new Date()

            const batchResults = await dbService.executeAtomic((database) => {
              const deletionAllowed = accountDeletionAllowedPredicate(userId)
              const statements: AtomicDbStatement[] = [
                database
                  .delete(loans)
                  .where(and(eq(loans.ownerUserId, userId), deletionAllowed))
                  .returning({ id: loans.id }),
                database
                  .update(loans)
                  .set({
                    borrowerUserId: null,
                    acceptedAt: null,
                    updatedAt: now
                  })
                  .where(and(eq(loans.borrowerUserId, userId), deletionAllowed))
                  .returning({ id: loans.id }),
                database
                  .delete(userBookTags)
                  .where(userBookIds.length > 0 ? and(inArray(userBookTags.userBookId, userBookIds), deletionAllowed) : sql`false`),
                database
                  .delete(userBooks)
                  .where(and(eq(userBooks.userId, userId), deletionAllowed))
                  .returning({ id: userBooks.id }),
                database
                  .delete(locations)
                  .where(and(eq(locations.userId, userId), deletionAllowed)),
                database
                  .delete(books)
                  .where(and(
                    eq(books.source, 'manual'),
                    eq(books.createdByUserId, userId),
                    deletionAllowed,
                    not(exists(
                      database
                        .select({ id: userBooks.id })
                        .from(userBooks)
                        .where(eq(userBooks.bookId, books.id))
                    ))
                  ))
                  .returning({
                    id: books.id,
                    coverPath: books.coverPath
                  }),
                database
                  .update(signupInvites)
                  .set({ acceptedByUserId: null, updatedAt: now })
                  .where(and(eq(signupInvites.acceptedByUserId, userId), deletionAllowed)),
                database
                  .delete(signupInvites)
                  .where(and(eq(signupInvites.createdByUserId, userId), deletionAllowed)),
                database
                  .delete(verification)
                  .where(verificationIdentifiers.length > 0
                    ? and(
                        or(
                          inArray(verification.identifier, verificationIdentifiers),
                          inArray(verification.value, verificationIdentifiers)
                        ),
                        deletionAllowed
                      )
                    : sql`false`),
                database
                  .delete(session)
                  .where(and(eq(session.userId, userId), deletionAllowed)),
                database
                  .delete(account)
                  .where(and(eq(account.userId, userId), deletionAllowed)),
                database
                  .delete(user)
                  .where(and(eq(user.id, userId), deletionAllowed))
                  .returning({ id: user.id })
              ]

              return statements as [AtomicDbStatement, ...AtomicDbStatement[]]
            })

            const deletedOwnedLoans = batchResults[0] as Array<{ id: string }>
            const anonymizedBorrowedLoans = batchResults[1] as Array<{ id: string }>
            const deletedUserBooks = batchResults[3] as Array<{ id: string }>
            const deletedManualBooks = batchResults[5] as Array<{ id: string, coverPath: string | null }>
            const deletedUsers = batchResults[11] as Array<{ id: string }>
            if (userRow && roleIncludesAdmin(userRow.role) && !isActiveBan(userRow) && deletedUsers.length === 0) {
              throw new LastAdminAccountDeletionError({
                message: 'Cannot delete the last remaining active admin account'
              })
            }

            const blobPaths = [
              userRow?.image,
              ...deletedManualBooks.map(row => row.coverPath)
            ].filter((path): path is string => typeof path === 'string' && !path.startsWith('http://') && !path.startsWith('https://'))

            return {
              deletedUserId: userId,
              blobPaths: [...new Set(blobPaths)],
              deletedManualBooks: deletedManualBooks.length,
              deletedUserBooks: deletedUserBooks.length,
              deletedOwnedLoans: deletedOwnedLoans.length,
              anonymizedBorrowedLoans: anonymizedBorrowedLoans.length
            }
          },
          catch: (error) => {
            const lastAdminError = toLastAdminAccountDeletionError(error)
            if (lastAdminError) {
              return lastAdminError
            }

            console.error('accountDeletion.deleteAccountData failed:', error)
            return new DatabaseError({
              message: 'Failed to delete account data',
              operation: 'accountDeletion.deleteAccountData'
            })
          }
        })
    }
  })
)

export const deleteAccountData = (userId: string) =>
  Effect.flatMap(AccountDeletionRepository, repository => repository.deleteAccountData(userId))

function adminRoleTokenPredicate() {
  return sql`(',' || replace(${user.role}, ' ', '') || ',') LIKE ${'%,admin,%'}`
}

function accountDeletionAllowedPredicate(userId: string) {
  return sql`(
    NOT EXISTS (
      SELECT 1 FROM ${user}
      WHERE ${user.id} = ${userId}
      AND ${adminRoleTokenPredicate()}
      AND ${inactiveBanPredicate()}
    )
    OR EXISTS (
      SELECT 1 FROM ${user}
      WHERE ${user.id} <> ${userId}
      AND ${adminRoleTokenPredicate()}
      AND ${inactiveBanPredicate()}
    )
  )`
}

function toLastAdminAccountDeletionError(error: unknown) {
  if (error instanceof LastAdminAccountDeletionError) {
    return error
  }

  if (typeof error === 'object'
    && error !== null
    && '_tag' in error
    && (error as { _tag?: unknown })._tag === 'LastAdminAccountDeletionError'
  ) {
    const taggedError = error as { message?: unknown }

    return new LastAdminAccountDeletionError({
      message: typeof taggedError.message === 'string'
        ? taggedError.message
        : 'Cannot delete the last remaining active admin account'
    })
  }

  return null
}

function inactiveBanPredicate() {
  return sql`(
    COALESCE(${user.banned}, false) = false
    OR (${user.banExpires} IS NOT NULL AND ${user.banExpires} <= (CAST(strftime('%s', 'now') AS INTEGER) * 1000))
  )`
}
