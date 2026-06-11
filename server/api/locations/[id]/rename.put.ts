import { Effect } from 'effect'
import { locationRenameSchema } from '../../../../shared/utils/schemas'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const locationId = getRouterParam(event, 'id')
    if (!locationId) {
      return yield* Effect.fail(createError({ statusCode: 400, message: 'Location ID is required' }))
    }

    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, locationRenameSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Invalid location rename' })
    })

    return yield* renameLocation(user.id, locationId, body)
  })
)
