import { Effect } from 'effect'
import { locationDeleteSchema } from '../../../../shared/utils/schemas'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const locationId = getRouterParam(event, 'id')
    if (!locationId) {
      return yield* Effect.fail(createError({ statusCode: 400, message: 'Location ID is required' }))
    }

    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, locationDeleteSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Invalid location delete' })
    })

    yield* deleteLocation(user.id, locationId, body)
    return { success: true }
  })
)
