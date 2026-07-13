import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const loanId = getRouterParam(event, 'id')
    if (!loanId) return yield* Effect.fail(createError({ statusCode: 400, message: 'Loan ID is required' }))
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, resendLoanInviteSchema.parse),
      catch: error => createError({ statusCode: 400, message: 'Validation Error', data: error })
    })
    return yield* resendLoanInviteForOwner(loanId, user.id, body.token)
  })
)
