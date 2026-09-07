import { describe, expect, it, vi } from 'vitest'
import { consumeOpenLibraryCapacity } from '../../../../server/utils/open-library-capacity'
import type { RateLimiter } from '../../../../server/utils/rate-limit'

function fixedWindowLimiter() {
  const counts = new Map<string, number>()
  const limiter: RateLimiter = {
    consume: vi.fn(async (key, limit) => {
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { allowed: count <= limit, retryAfterSeconds: 1 }
    })
  }
  return limiter
}

describe('Open Library capacity', () => {
  it('leaves capacity for a lookup during a burst of enrichment requests', async () => {
    const limiter = fixedWindowLimiter()
    const background = await Promise.all(Array.from({ length: 8 }, () =>
      consumeOpenLibraryCapacity(limiter, true, 'enrichment')
    ))
    expect(background.filter(result => result.allowed)).toHaveLength(2)
    await expect(consumeOpenLibraryCapacity(limiter, true, 'interactive')).resolves.toMatchObject({ allowed: true })
    await expect(consumeOpenLibraryCapacity(limiter, true, 'interactive')).resolves.toMatchObject({ allowed: false })
  })

  it('enforces the global allowance when interactive requests arrive first', async () => {
    const limiter = fixedWindowLimiter()
    await Promise.all(Array.from({ length: 3 }, () => consumeOpenLibraryCapacity(limiter, true, 'interactive')))
    await expect(consumeOpenLibraryCapacity(limiter, true, 'enrichment')).resolves.toMatchObject({ allowed: false })
  })

  it('keeps anonymous enrichment eligible without bypassing the global limit', async () => {
    const limiter = fixedWindowLimiter()
    await expect(consumeOpenLibraryCapacity(limiter, false, 'enrichment')).resolves.toMatchObject({ allowed: true })
    await expect(consumeOpenLibraryCapacity(limiter, false, 'interactive')).resolves.toMatchObject({ allowed: false })
    expect(limiter.consume).toHaveBeenCalledTimes(2)
    expect(limiter.consume).toHaveBeenCalledWith('openlibrary:outbound', 1, 1)
  })

  it('propagates limiter failure without authorizing an outbound request', async () => {
    const limiter = { consume: vi.fn().mockRejectedValue(new Error('database unavailable')) }
    await expect(consumeOpenLibraryCapacity(limiter, true, 'enrichment')).rejects.toThrow('database unavailable')
    expect(limiter.consume).toHaveBeenCalledTimes(1)
  })
})
