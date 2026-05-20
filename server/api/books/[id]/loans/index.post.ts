import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const userBookId = getRouterParam(event, 'id')

    if (!userBookId) {
      return yield* Effect.fail(createError({ statusCode: 400, message: 'Book ID is required' }))
    }

    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, createLoanSchema.parse),
      catch: e => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })

    return yield* createLoanForBook(userBookId, user.id, body)
  })
)
