import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const loanId = getRouterParam(event, 'id')

    if (!loanId) {
      return yield* Effect.fail(createError({ statusCode: 400, message: 'Loan ID is required' }))
    }

    return yield* returnLoanForOwner(loanId, user.id)
  })
)
