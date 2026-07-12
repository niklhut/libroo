export interface RateLimitStore {
  increment(key: string, windowMs: number, now: number): { count: number, resetAt: number }
}

interface Counter {
  count: number
  resetAt: number
}

/** Best-effort, process-local fixed-window counter. */
export class InMemoryFixedWindowRateLimitStore implements RateLimitStore {
  private readonly counters = new Map<string, Counter>()

  increment(key: string, windowMs: number, now: number) {
    const existing = this.counters.get(key)
    if (!existing || now >= existing.resetAt) {
      const counter = { count: 1, resetAt: now + windowMs }
      this.counters.set(key, counter)
      return counter
    }

    existing.count += 1
    return existing
  }
}

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
}

export function checkFixedWindowRateLimit(
  store: RateLimitStore,
  key: string,
  maxRequests: number,
  windowSeconds: number,
  now = Date.now()
): RateLimitResult {
  const counter = store.increment(key, windowSeconds * 1000, now)
  return {
    allowed: counter.count <= maxRequests,
    retryAfterSeconds: Math.max(1, Math.ceil((counter.resetAt - now) / 1000))
  }
}
