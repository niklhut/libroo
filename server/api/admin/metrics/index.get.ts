import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    return yield* getAdminMetrics({
      actor: user,
      headers: event.headers
    })
  })
)
