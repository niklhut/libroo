import { Context, Effect, Layer } from 'effect'
import type { DatabaseError } from '../repositories/book.repository'
import { RateLimitRepository } from '../repositories/rate-limit.repository'
import type { DbService } from './db.service'

const DEFAULT_WINDOW_SECONDS = 60

interface CleanupRateLimitCountersInput {
  windowSeconds?: unknown
  now?: Date
}

export interface RateLimitServiceInterface {
  cleanupExpiredCounters: (
    input?: CleanupRateLimitCountersInput
  ) => Effect.Effect<{ deleted: number, windowSeconds: number }, DatabaseError, RateLimitRepository | DbService>
}

export class RateLimitService extends Context.Tag('RateLimitService')<RateLimitService, RateLimitServiceInterface>() { }

export const RateLimitServiceLive = Layer.effect(
  RateLimitService,
  Effect.gen(function* () {
    const rateLimitRepository = yield* RateLimitRepository

    return {
      cleanupExpiredCounters: (input = {}) =>
        Effect.gen(function* () {
          const windowSeconds = positiveInteger(input.windowSeconds, DEFAULT_WINDOW_SECONDS)
          const now = input.now ?? new Date()
          const deleted = yield* rateLimitRepository.deleteOlderThan(
            now.getTime() - windowSeconds * 1000
          )

          return { deleted, windowSeconds }
        })
    }
  })
)

export const cleanupExpiredRateLimitCounters = (input?: CleanupRateLimitCountersInput) =>
  Effect.flatMap(RateLimitService, service => service.cleanupExpiredCounters(input))

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
