import { Effect } from 'effect'
import { locationDeleteSchema } from '../../../../shared/utils/schemas'

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : undefined
  }

  return typeof value === 'string' ? value : undefined
}

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const locationId = getRouterParam(event, 'id')
    if (!locationId) {
      return yield* Effect.fail(createError({ statusCode: 400, message: 'Location ID is required' }))
    }

    const body = yield* Effect.tryPromise({
      try: async () => {
        const query = getQuery(event)
        return locationDeleteSchema.parse({
          mode: firstQueryValue(query.mode),
          targetLocationId: firstQueryValue(query.targetLocationId)
        })
      },
      catch: () => createError({ statusCode: 400, message: 'Invalid location delete' })
    })

    yield* deleteLocation(user.id, locationId, body)
    return { success: true }
  })
)
