import { Effect } from 'effect'
import { locationCreateSchema } from '../../../shared/utils/schemas'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, locationCreateSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Invalid location' })
    })

    return yield* createLocation(user.id, body)
  })
)
