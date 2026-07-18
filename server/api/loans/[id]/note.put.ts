import { Effect } from 'effect'
import { loanNoteSchema } from '../../../../shared/utils/schemas'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const loanId = getRouterParam(event, 'id')
    if (!loanId) return yield* Effect.fail(createError({ statusCode: 400, message: 'Loan ID is required' }))
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, loanNoteSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Invalid note' })
    })
    yield* updateLoanNote(loanId, user.id, body.note)
    return { success: true }
  })
)
