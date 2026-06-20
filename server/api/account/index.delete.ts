import { Effect } from 'effect'
import { accountDeletionSchema } from '~~/shared/utils/account-settings'
import { deleteOwnAccount } from '../../services/account-deletion.service'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, accountDeletionSchema.parse),
      catch: error => createError({
        statusCode: 400,
        message: error instanceof Error ? error.message : 'Invalid account deletion request'
      })
    })

    const result = yield* deleteOwnAccount(event, user.id, body)

    return {
      success: true,
      deletedUserBooks: result.deletedUserBooks,
      deletedManualBooks: result.deletedManualBooks,
      deletedOwnedLoans: result.deletedOwnedLoans,
      anonymizedBorrowedLoans: result.anonymizedBorrowedLoans
    }
  }),
{ auth: 'session' })
