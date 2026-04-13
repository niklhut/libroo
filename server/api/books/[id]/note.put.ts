import { Effect } from 'effect'
import { bookNoteSchema } from '../../../../shared/utils/schemas'

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
      try: () => readValidatedBody(event, bookNoteSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Invalid note' })
    })

    yield* updateNote(userBookId, user.id, body.note)

    return { success: true }
  })
)
