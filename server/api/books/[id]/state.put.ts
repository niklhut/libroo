import { Effect } from 'effect'
import { bookLibraryStateSchema } from '../../../../shared/utils/schemas'

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
      try: () => readValidatedBody(event, bookLibraryStateSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Invalid library state' })
    })

    const book = yield* updateLibraryState(userBookId, user.id, body.state)

    return { success: true, book }
  })
)
