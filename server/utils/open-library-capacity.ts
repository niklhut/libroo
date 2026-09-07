import type { RateLimiter, RateLimitResult } from './rate-limit'

export type OpenLibraryRequestPriority = 'interactive' | 'enrichment'

/**
 * Keep enrichment below the identified-client allowance so new ISBN lookups
 * have capacity during sustained background work. The shared global limiter
 * still authorizes every request across Worker isolates. At the anonymous
 * one-request allowance, use the global budget alone to avoid starving jobs.
 */
export async function consumeOpenLibraryCapacity(
  limiter: RateLimiter,
  identified: boolean,
  priority: OpenLibraryRequestPriority
): Promise<RateLimitResult> {
  if (identified && priority === 'enrichment') {
    const background = await limiter.consume('openlibrary:enrichment', 2, 1)
    if (!background.allowed) return background
  }
  return limiter.consume('openlibrary:outbound', identified ? 3 : 1, 1)
}
