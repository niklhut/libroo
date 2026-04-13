import { Effect } from 'effect'
import { bookRatingSchema } from '../../../../shared/utils/schemas'

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

    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, bookRatingSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Invalid rating' })
    })

    yield* updateRating(userBookId, user.id, body.rating)

    return { success: true }
  })
)
