import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const userBookId = getRouterParam(event, 'id')

    if (!userBookId) {
      return yield* Effect.fail(
        createError({
          statusCode: 400,
          message: 'Book ID is required'
        })
      )
    }

    // Get book details via BookService (verifies ownership)
    return yield* getBookDetails(userBookId, user.id)
  })
)
