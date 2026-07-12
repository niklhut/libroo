import { describe, expect, it } from 'vitest'
import { checkFixedWindowRateLimit, InMemoryFixedWindowRateLimitStore } from '../../../../server/utils/rate-limit'

describe('server/utils/rate-limit', () => {
  it('allows requests under the limit and rejects requests over it', () => {
    const store = new InMemoryFixedWindowRateLimitStore()

    expect(checkFixedWindowRateLimit(store, 'user:ada', 2, 60, 1_000).allowed).toBe(true)
    expect(checkFixedWindowRateLimit(store, 'user:ada', 2, 60, 1_001).allowed).toBe(true)
    expect(checkFixedWindowRateLimit(store, 'user:ada', 2, 60, 1_002)).toMatchObject({ allowed: false, retryAfterSeconds: 60 })
  })

  it('keeps different rate-limit keys isolated', () => {
    const store = new InMemoryFixedWindowRateLimitStore()
    checkFixedWindowRateLimit(store, 'user:ada', 1, 60, 1_000)

    expect(checkFixedWindowRateLimit(store, 'user:grace', 1, 60, 1_001).allowed).toBe(true)
  })

  it('resets a key after its fixed window elapses', () => {
    const store = new InMemoryFixedWindowRateLimitStore()
    checkFixedWindowRateLimit(store, 'ip:127.0.0.1', 1, 10, 1_000)
    expect(checkFixedWindowRateLimit(store, 'ip:127.0.0.1', 1, 10, 1_001).allowed).toBe(false)

    expect(checkFixedWindowRateLimit(store, 'ip:127.0.0.1', 1, 10, 11_000).allowed).toBe(true)
  })
})
