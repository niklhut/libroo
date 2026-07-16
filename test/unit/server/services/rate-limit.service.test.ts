import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RateLimitRepository } from '../../../../server/repositories/rate-limit.repository'
import { RateLimitService, RateLimitServiceLive } from '../../../../server/services/rate-limit.service'
import type { DbService } from '../../../../server/services/db.service'

describe('RateLimitService', () => {
  beforeEach(() => {
    rateLimitRepositoryMock.deleteOlderThan.mockReset()
    rateLimitRepositoryMock.deleteOlderThan.mockReturnValue(Effect.succeed(0))
  })

  it('deletes counters once their configured window has elapsed', async () => {
    rateLimitRepositoryMock.deleteOlderThan.mockReturnValue(Effect.succeed(4))

    await expect(runRateLimitService(
      Effect.flatMap(RateLimitService, service => service.cleanupExpiredCounters({
        windowSeconds: 90,
        now: new Date('2026-07-16T03:00:00.000Z')
      }))
    )).resolves.toEqual({ deleted: 4, windowSeconds: 90 })

    expect(rateLimitRepositoryMock.deleteOlderThan).toHaveBeenCalledWith(
      new Date('2026-07-16T03:00:00.000Z').getTime() - 90_000
    )
  })

  it('uses the safe default window for invalid cleanup configuration', async () => {
    await expect(runRateLimitService(
      Effect.flatMap(RateLimitService, service => service.cleanupExpiredCounters({
        windowSeconds: 0,
        now: new Date('2026-07-16T03:00:00.000Z')
      }))
    )).resolves.toMatchObject({ windowSeconds: 60 })
  })
})

const rateLimitRepositoryMock = {
  deleteOlderThan: vi.fn()
}

function runRateLimitService<A, E>(effect: Effect.Effect<A, E, RateLimitService | RateLimitRepository | DbService>) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(RateLimitServiceLive),
    Effect.provide(Layer.succeed(RateLimitRepository, rateLimitRepositoryMock))
  ))
}
