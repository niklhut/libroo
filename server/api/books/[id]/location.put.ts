import { Effect } from 'effect'
import { bookLocationSchema } from '../../../../shared/utils/schemas'

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
      try: () => readValidatedBody(event, bookLocationSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Invalid location' })
    })

    const location = yield* updateLocation(userBookId, user.id, body.locationId)

    return { success: true, location }
  })
)
