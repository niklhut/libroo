import { sql } from 'drizzle-orm'
import { rateLimitCounters } from '../db/schema/rate-limit'
import type { DbServiceInterface } from '../services/db.service'
import type { RateLimitResult, RateLimiter } from './rate-limit'

/**
 * The shared database fixed-window limiter. Its one UPSERT is the entire
 * decision; do not replace it with a select followed by an insert or update.
 */
export class DatabaseRateLimiter implements RateLimiter {
  constructor(
    private readonly dbService: DbServiceInterface,
    private readonly now: () => number = Date.now
  ) {}

  async consume(key: string, maxRequests: number, windowSeconds: number): Promise<RateLimitResult> {
    const windowMs = windowSeconds * 1000
    const windowStart = this.now()
    const expiredBefore = windowStart - windowMs

    try {
      const results = await this.dbService.executeAtomic(database => [
        database.insert(rateLimitCounters).values({ key, count: 1, windowStart })
          .onConflictDoUpdate({
            target: rateLimitCounters.key,
            set: {
              count: sql`CASE WHEN ${rateLimitCounters.windowStart} <= ${expiredBefore} THEN 1 ELSE ${rateLimitCounters.count} + 1 END`,
              windowStart: sql`CASE WHEN ${rateLimitCounters.windowStart} <= ${expiredBefore} THEN ${windowStart} ELSE ${rateLimitCounters.windowStart} END`
            }
          })
          .returning({ count: rateLimitCounters.count, windowStart: rateLimitCounters.windowStart })
      ])
      const row = (results[0] as Array<{ count: number, windowStart: number }> | undefined)?.[0]
      if (!row) throw new Error('Atomic rate-limit upsert did not return a counter')

      const result = {
        allowed: row.count <= maxRequests,
        retryAfterSeconds: Math.max(1, Math.ceil((row.windowStart + windowMs - windowStart) / 1000))
      }
      console.warn('database-rate-limit decision', {
        component: 'database-rate-limit', outcome: result.allowed ? 'allow' : 'deny',
        key: redactKey(key), limit: maxRequests, windowSeconds, retryAfterSeconds: result.retryAfterSeconds
      })
      return result
    } catch (error) {
      console.error('database-rate-limit failure', {
        component: 'database-rate-limit', severity: 'error', operation: 'consume', key: redactKey(key),
        error: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }
}

export function redactKey(key: string) {
  const separator = key.indexOf(':')
  return separator === -1 ? 'redacted' : `${key.slice(0, separator)}:redacted`
}
