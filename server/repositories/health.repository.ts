import { Context, Data, Effect, Layer } from 'effect'
import { sql } from 'drizzle-orm'
import { user } from 'hub:db:schema'
import { DbService } from '../services/db.service'

export class HealthCheckError extends Data.TaggedError('HealthCheckError')<{
  message: string
}> { }

export interface HealthRepositoryInterface {
  checkDatabase: () => Effect.Effect<void, HealthCheckError>
}

export class HealthRepository extends Context.Tag('HealthRepository')<HealthRepository, HealthRepositoryInterface>() { }

export const HealthRepositoryLive = Layer.effect(
  HealthRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      checkDatabase: () =>
        Effect.tryPromise({
          try: async () => {
            await dbService.db
              .select({ ok: sql<number>`1` })
              .from(user)
              .limit(1)
          },
          catch: (error) => {
            console.error('Database health check failed', error)
            return new HealthCheckError({
              message: 'Database health check failed'
            })
          }
        })
    }
  })
)
