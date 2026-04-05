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

    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, bookTagAddSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Validation Error' })
    })

    const tag = yield* addUserTag(userBookId, user.id, body.name)
    return { success: true, tag }
  })
)
