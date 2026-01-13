import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    // Get userBook ID from route params
    const userBookId = getRouterParam(event, 'id')

    if (!userBookId) {
      return yield* Effect.fail(
        createError({
          statusCode: 400,
          message: 'Book ID is required'
        })
      )
    }

    // Remove book from user's library
    yield* removeFromLibrary(userBookId, user.id)

    return { success: true }
  })
)
