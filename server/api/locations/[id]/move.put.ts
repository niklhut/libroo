import { Effect } from 'effect'
import { locationMoveSchema } from '../../../../shared/utils/schemas'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const locationId = getRouterParam(event, 'id')
    if (!locationId) {
      return yield* Effect.fail(createError({ statusCode: 400, message: 'Location ID is required' }))
    }

    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, locationMoveSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Invalid location move' })
    })

    return yield* moveLocation(user.id, locationId, body)
  })
)
