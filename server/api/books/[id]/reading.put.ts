import { Effect } from 'effect'
import { bookReadingProgressSchema } from '../../../../shared/utils/schemas'

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
      try: () => readValidatedBody(event, bookReadingProgressSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Invalid reading progress' })
    })

    const readingProgress = yield* updateReadingProgress(userBookId, user.id, body)

    return { success: true, readingProgress }
  })
)
