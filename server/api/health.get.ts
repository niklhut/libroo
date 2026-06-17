import { Effect } from 'effect'

export default effectHandler(() =>
  Effect.gen(function* () {
    const healthService = yield* HealthService
    return yield* healthService.getStatus()
  }),
{ auth: false })
