import { Context, Effect, Layer } from 'effect'
import packageJson from '../../package.json'

export interface HealthStatus {
  status: 'ok'
  version?: string
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
            version: packageJson.version,
            checks: {
              database: 'ok'
            }
          } satisfies HealthStatus
        })
    }
  })
)
