import { Context, Data, Effect, Layer } from 'effect'
import type { H3Event } from 'h3'
import { accountDeletionSchema } from '~~/shared/utils/account-settings'
import { deleteAccountData } from '../repositories/account-deletion.repository'
import type { AccountDeletionRepository, AccountDeletionResult, LastAdminAccountDeletionError } from '../repositories/account-deletion.repository'
import type { DatabaseError } from '../repositories/book.repository'
import { deleteBlob } from './storage.service'
import type { StorageService } from './storage.service'
import { auth } from '../utils/auth'
import { UnauthorizedError } from './auth.service'

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
  ) => Effect.Effect<AccountDeletionResult, InvalidAccountDeletionConfirmationError | LastAdminAccountDeletionError | UnauthorizedError | DatabaseError, AccountDeletionRepository | StorageService>
}

export class AccountDeletionService extends Context.Tag('AccountDeletionService')<AccountDeletionService, AccountDeletionServiceInterface>() { }

export const AccountDeletionServiceLive = Layer.succeed(AccountDeletionService, {
  deleteOwnAccount: (event, userId, input) =>
    Effect.gen(function* () {
      const parsed = accountDeletionSchema.safeParse(input)

      if (!parsed.success) {
        return yield* Effect.fail(new InvalidAccountDeletionConfirmationError({
          message: parsed.error.issues[0]?.message ?? 'Account deletion confirmation is invalid'
        }))
      }

      yield* Effect.tryPromise({
        try: () => auth.api.verifyPassword({
          headers: event.headers,
          body: {
            password: parsed.data.currentPassword
          }
        }),
        catch: () => new UnauthorizedError({ message: 'Current password is incorrect' })
      })

      const result = yield* deleteAccountData(userId)

      for (const blobPath of result.blobPaths) {
        yield* deleteBlob(blobPath).pipe(
          Effect.catchAll(error =>
            Effect.logWarning(`Failed to delete account blob ${blobPath}: ${String(error)}`)
          )
        )
      }

      return result
    })
})

export const deleteOwnAccount = (event: H3Event, userId: string, input: AccountDeletionInput) =>
  Effect.flatMap(AccountDeletionService, service => service.deleteOwnAccount(event, userId, input))
