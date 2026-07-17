import { describe, expect, it, vi } from 'vitest'
import { DatabaseRateLimiter } from '../../../../server/utils/database-rate-limiter'

function dbWithRows(...rows: Array<{ count: number, windowStart: number }>) {
  const returning = vi.fn(() => ({ statement: 'atomic-upsert' }))
  const database = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({ returning }))
      }))
    }))
  }
  const executeAtomic = vi.fn(async (buildStatements) => {
    const statements = buildStatements(database as never)
    expect(statements).toHaveLength(1)
    return [[rows.shift()]]
  })
  return { executeAtomic, database, returning }
}

describe('DatabaseRateLimiter', () => {
  it('makes each concurrent consume through exactly one atomic upsert', async () => {
    const service = dbWithRows(
      { count: 1, windowStart: 1_000 },
      { count: 2, windowStart: 1_000 },
      { count: 3, windowStart: 1_000 }
    )
    const limiter = new DatabaseRateLimiter(service as never, () => 1_000)

    const results = await Promise.all([
      limiter.consume('ip:test', 2, 60),
      limiter.consume('ip:test', 2, 60),
      limiter.consume('ip:test', 2, 60)
    ])

    expect(results.map(result => result.allowed)).toEqual([true, true, false])
    expect(service.executeAtomic).toHaveBeenCalledTimes(3)
  })

  it('derives retry-after from the returned window start and resets window counts', async () => {
    const service = dbWithRows(
      { count: 1, windowStart: 10_000 },
      { count: 2, windowStart: 10_000 }
    )
    const limiter = new DatabaseRateLimiter(service as never, () => 10_500)

    await expect(limiter.consume('user:ada', 1, 60)).resolves.toMatchObject({ allowed: true, retryAfterSeconds: 60 })
    await expect(limiter.consume('user:ada', 1, 60)).resolves.toMatchObject({ allowed: false, retryAfterSeconds: 60 })
  })
})
