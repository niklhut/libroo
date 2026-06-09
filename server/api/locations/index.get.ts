import { Effect } from 'effect'

export default effectHandler((_event, user) =>
  Effect.gen(function* () {
    return yield* listLocations(user.id)
  })
)
