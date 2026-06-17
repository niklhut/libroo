import { Context, Effect, Layer } from 'effect'

export interface HealthStatus {
  status: 'ok'
  checks: {
    database: 'ok'
  }
}

export interface HealthServiceInterface {
  getStatus: () => Effect.Effect<HealthStatus, HealthCheckError>
}

export class HealthService extends Context.Tag('HealthService')<HealthService, HealthServiceInterface>() { }

export const HealthServiceLive = Layer.effect(
  HealthService,
  Effect.gen(function* () {
    const healthRepository = yield* HealthRepository

    return {
      getStatus: () =>
        Effect.gen(function* () {
          yield* healthRepository.checkDatabase()

          return {
            status: 'ok',
            checks: {
              database: 'ok'
            }
          } satisfies HealthStatus
        })
    }
  })
)
