/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import rateLimitMigration from '../../../../server/db/migrations/sqlite/0009_redundant_black_bolt.sql?raw'
import { rateLimitCounters } from '../../../../server/db/schema/rate-limit'
import { DatabaseRateLimiter } from '../../../../server/utils/database-rate-limiter'
import type { DbServiceInterface } from '../../../../server/services/db.service'

describe('DatabaseRateLimiter on D1', () => {
  const database = drizzle(env.DB)
  const dbService: DbServiceInterface = {
    db: database as unknown as DbServiceInterface['db'],
    executeAtomic: (buildStatements) => {
      const typedDatabase = database as unknown as DbServiceInterface['db']
      return typedDatabase.batch(buildStatements(typedDatabase))
    }
  }

  beforeAll(async () => {
    for (const statement of rateLimitMigration.split('--> statement-breakpoint')) {
      if (statement.trim()) await env.DB.prepare(statement.trim()).run()
    }
  })

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM rate_limit_counters').run()
  })

  it('uses one D1 atomic upsert for limits, denial, and window reset', async () => {
    const limiter = new DatabaseRateLimiter(dbService, () => 10_000)
    await expect(limiter.consume('ip:198.51.100.4', 2, 60)).resolves.toMatchObject({ allowed: true, retryAfterSeconds: 60 })
    await expect(limiter.consume('ip:198.51.100.4', 2, 60)).resolves.toMatchObject({ allowed: true })
    await expect(limiter.consume('ip:198.51.100.4', 2, 60)).resolves.toMatchObject({ allowed: false, retryAfterSeconds: 60 })

    const resetLimiter = new DatabaseRateLimiter(dbService, () => 70_001)
    await expect(resetLimiter.consume('ip:198.51.100.4', 2, 60)).resolves.toMatchObject({ allowed: true, retryAfterSeconds: 60 })
    await expect(database.select().from(rateLimitCounters)).resolves.toMatchObject([
      { key: 'ip:198.51.100.4', count: 1, windowStart: 70_001 }
    ])
  })
})
