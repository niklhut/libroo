import { Context, Effect, Layer } from 'effect'
import { lt } from 'drizzle-orm'
import { rateLimitCounters } from '../db/schema/rate-limit'
import { DatabaseError } from './book.repository'
import { DbService } from '../services/db.service'

export interface RateLimitRepositoryInterface {
  deleteOlderThan: (before: number) => Effect.Effect<number, DatabaseError, DbService>
}

export class RateLimitRepository extends Context.Tag('RateLimitRepository')<RateLimitRepository, RateLimitRepositoryInterface>() { }

export const RateLimitRepositoryLive = Layer.effect(
  RateLimitRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      deleteOlderThan: before =>
        Effect.tryPromise({
          try: async () => {
            const result = await dbService.db
              .delete(rateLimitCounters)
              .where(lt(rateLimitCounters.windowStart, before))

            return getAffectedRowCount(result)
          },
          catch: error => new DatabaseError({
            message: `Failed to delete expired rate-limit counters: ${error}`,
            operation: 'rateLimit.deleteExpired'
          })
        })
    }
  })
)

function getAffectedRowCount(result: unknown) {
  if (!result || typeof result !== 'object') return 0

  if ('rowsAffected' in result && typeof result.rowsAffected === 'number') {
    return result.rowsAffected
  }
  if ('meta' in result && result.meta && typeof result.meta === 'object'
    && 'rows_written' in result.meta && typeof result.meta.rows_written === 'number') {
    return result.meta.rows_written
  }

  return 0
}
