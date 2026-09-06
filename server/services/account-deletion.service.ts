import { Context, Data, Effect, Layer } from 'effect'
import type { H3Event } from 'h3'
import { accountDeletionSchema } from '~~/shared/utils/account-settings'
import { deleteAccountData } from '../repositories/account-deletion.repository'
import type { AccountDeletionRepository, AccountDeletionResult, LastAdminAccountDeletionError } from '../repositories/account-deletion.repository'
import type { DatabaseError } from '../repositories/book.repository'
import { BookEnrichmentRepository } from '../repositories/book-enrichment.repository'
import { deleteBlob } from './storage.service'
import type { StorageService } from './storage.service'
import type { DbService } from './db.service'
import { UnauthorizedError } from './auth.service'
import { verifyPasswordOrRequireRecentAuth } from './recent-auth.service'

export class InvalidAccountDeletionConfirmationError extends Data.TaggedError('InvalidAccountDeletionConfirmationError')<{
  message: string
}> { }

export interface AccountDeletionInput {
  currentPassword: string
  confirmation: string
}

export interface AccountDeletionServiceInterface {
  deleteOwnAccount: (
    event: H3Event,
    userId: string,
    input: AccountDeletionInput
  ) => Effect.Effect<AccountDeletionResult, InvalidAccountDeletionConfirmationError | LastAdminAccountDeletionError | UnauthorizedError | DatabaseError, AccountDeletionRepository | BookEnrichmentRepository | DbService | StorageService>
}

export class AccountDeletionService extends Context.Tag('AccountDeletionService')<AccountDeletionService, AccountDeletionServiceInterface>() { }

const SHARED_COVER_CLEANUP_LEASE_MS = 60_000

function isbnFromSharedCoverPath(pathname: string) {
  return /^covers\/([^/]+)\.webp$/.exec(pathname)?.[1] ?? null
}

export const AccountDeletionServiceLive = Layer.succeed(AccountDeletionService, {
  deleteOwnAccount: (event, userId, input) =>
    Effect.gen(function* () {
      const parsed = accountDeletionSchema.safeParse(input)

      if (!parsed.success) {
        return yield* Effect.fail(new InvalidAccountDeletionConfirmationError({
          message: parsed.error.issues[0]?.message ?? 'Account deletion confirmation is invalid'
        }))
      }

      yield* verifyPasswordOrRequireRecentAuth(event, parsed.data.currentPassword).pipe(
        Effect.mapError(error => new UnauthorizedError({ message: error.message }))
      )

      const result = yield* deleteAccountData(userId)

      for (const blobPath of result.blobPaths) {
        yield* deleteBlob(blobPath).pipe(
          Effect.catchAll(error =>
            Effect.logWarning(`Failed to delete account blob ${blobPath}: ${String(error)}`)
          )
        )
      }

      const enrichmentRepo = yield* BookEnrichmentRepository
      yield* Effect.forEach(
        result.sharedCoverPaths,
        sharedCoverPath =>
          Effect.gen(function* () {
            const isbn = isbnFromSharedCoverPath(sharedCoverPath)
            if (!isbn) {
              yield* Effect.logWarning(`Skipped shared account cover with an unsupported path: ${sharedCoverPath}`)
              return
            }

            const claimToken = `account-deletion:${crypto.randomUUID()}`
            const now = new Date()
            const leaseExpiresAt = new Date(now.getTime() + SHARED_COVER_CLEANUP_LEASE_MS)
            const acquired = yield* enrichmentRepo.acquireIsbnLocks(
              [isbn],
              claimToken,
              leaseExpiresAt,
              now
            ).pipe(
              Effect.catchAll(error =>
                Effect.logWarning(`Failed to lock shared account cover ${sharedCoverPath}: ${String(error)}`).pipe(
                  Effect.as(new Set<string>())
                )
              )
            )
            if (!acquired.has(isbn)) return

            yield* Effect.gen(function* () {
              const referenced = yield* enrichmentRepo.isCoverReferenced(sharedCoverPath).pipe(
                Effect.catchAll(error =>
                  Effect.logWarning(`Failed to check shared account cover ${sharedCoverPath}: ${String(error)}`).pipe(
                    Effect.as(true)
                  )
                )
              )
              if (referenced) return
              yield* deleteBlob(sharedCoverPath).pipe(
                Effect.catchAll(error =>
                  Effect.logWarning(`Failed to delete unreferenced account cover ${sharedCoverPath}: ${String(error)}`)
                )
              )
            }).pipe(
              Effect.ensuring(
                enrichmentRepo.releaseIsbnLocks([isbn], claimToken).pipe(
                  Effect.catchAll(error =>
                    Effect.logWarning(`Failed to unlock shared account cover ${sharedCoverPath}: ${String(error)}`)
                  )
                )
              )
            )
          }),
        { concurrency: 4 }
      )

      return result
    })
})

export const deleteOwnAccount = (event: H3Event, userId: string, input: AccountDeletionInput) =>
  Effect.flatMap(AccountDeletionService, service => service.deleteOwnAccount(event, userId, input))
