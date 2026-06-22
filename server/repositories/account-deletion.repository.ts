import { Context, Effect, Layer, Data } from 'effect'
import { and, eq, exists, inArray, not, or, sql } from 'drizzle-orm'
import { account, books, locations, loans, session, signupInvites, user, userBookTags, userBooks, verification } from 'hub:db:schema'
import { roleIncludesAdmin } from '~~/shared/utils/auth-roles'
import { isActiveBan } from '~~/shared/utils/auth-status'
import { DatabaseError } from './book.repository'
import { DbService } from '../services/db.service'

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
            return dbService.db.transaction(async (tx) => {
              const [userRow] = await tx
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
                const otherAdminRows = await tx
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

              const userBookRows = await tx
                .select({ id: userBooks.id })
                .from(userBooks)
                .where(eq(userBooks.userId, userId))
              const userBookIds = userBookRows.map(row => row.id)

              const deletedOwnedLoans = await tx
                .delete(loans)
                .where(eq(loans.ownerUserId, userId))
                .returning({ id: loans.id })

              const anonymizedBorrowedLoans = await tx
                .update(loans)
                .set({
                  borrowerUserId: null,
                  acceptedAt: null,
                  updatedAt: new Date()
                })
                .where(eq(loans.borrowerUserId, userId))
                .returning({ id: loans.id })

              if (userBookIds.length > 0) {
                await tx
                  .delete(userBookTags)
                  .where(inArray(userBookTags.userBookId, userBookIds))
              }

              const deletedUserBooks = await tx
                .delete(userBooks)
                .where(eq(userBooks.userId, userId))
                .returning({ id: userBooks.id })

              await tx
                .delete(locations)
                .where(eq(locations.userId, userId))

              const deletedManualBooks = await tx
                .delete(books)
                .where(and(
                  eq(books.source, 'manual'),
                  eq(books.createdByUserId, userId),
                  not(exists(
                    tx
                      .select({ id: userBooks.id })
                      .from(userBooks)
                      .where(eq(userBooks.bookId, books.id))
                  ))
                ))
                .returning({
                  id: books.id,
                  coverPath: books.coverPath
                })

              await tx
                .update(signupInvites)
                .set({ acceptedByUserId: null, updatedAt: new Date() })
                .where(eq(signupInvites.acceptedByUserId, userId))

              await tx
                .delete(signupInvites)
                .where(eq(signupInvites.createdByUserId, userId))

              const verificationIdentifiers = [userRow?.email, userRow?.pendingEmail]
                .filter((value): value is string => Boolean(value))

              if (verificationIdentifiers.length > 0) {
                await tx
                  .delete(verification)
                  .where(or(
                    inArray(verification.identifier, verificationIdentifiers),
                    inArray(verification.value, verificationIdentifiers)
                  ))
              }

              await tx
                .delete(session)
                .where(eq(session.userId, userId))

              await tx
                .delete(account)
                .where(eq(account.userId, userId))

              await tx
                .delete(user)
                .where(eq(user.id, userId))

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
            })
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
    OR (${user.banExpires} IS NOT NULL AND ${user.banExpires} <= ${new Date()})
  )`
}
