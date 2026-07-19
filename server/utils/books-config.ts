import { MAX_BULK_ISBN_COUNT } from '~~/shared/utils/schemas'

type BooksRuntimeConfig = {
  booksBulkAddMaxCount?: unknown
  booksRateLimitEnabled?: unknown
  booksRateLimitWindowSeconds?: unknown
  booksRateLimitMaxRequests?: unknown
  booksBulkLookupRateLimitWindowSeconds?: unknown
  booksBulkLookupRateLimitMaxRequests?: unknown
}

function runtimeValue(key: keyof BooksRuntimeConfig): unknown {
  try {
    return (useRuntimeConfig() as BooksRuntimeConfig)[key]
  } catch {
    return undefined
  }
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function getBulkAddMaxCount(): number {
  return positiveInteger(runtimeValue('booksBulkAddMaxCount') ?? process.env.NUXT_BOOKS_BULK_ADD_MAX_COUNT, MAX_BULK_ISBN_COUNT)
}

export function getBooksRateLimitConfig() {
  const enabled = runtimeValue('booksRateLimitEnabled') ?? process.env.NUXT_BOOKS_RATE_LIMIT_ENABLED ?? 'false'
  const windowSeconds = positiveInteger(
    runtimeValue('booksRateLimitWindowSeconds') ?? process.env.NUXT_BOOKS_RATE_LIMIT_WINDOW_SECONDS,
    60
  )
  const maxRequests = positiveInteger(
    runtimeValue('booksRateLimitMaxRequests') ?? process.env.NUXT_BOOKS_RATE_LIMIT_MAX_REQUESTS,
    30
  )

  return {
    enabled: enabled === true || enabled === 'true',
    windowSeconds,
    maxRequests
  }
}

export function getBulkLookupRateLimitConfig() {
  const base = getBooksRateLimitConfig()
  return {
    enabled: base.enabled,
    windowSeconds: positiveInteger(
      runtimeValue('booksBulkLookupRateLimitWindowSeconds') ?? process.env.NUXT_BOOKS_BULK_LOOKUP_RATE_LIMIT_WINDOW_SECONDS,
      60
    ),
    maxRequests: positiveInteger(
      runtimeValue('booksBulkLookupRateLimitMaxRequests') ?? process.env.NUXT_BOOKS_BULK_LOOKUP_RATE_LIMIT_MAX_REQUESTS,
      10
    )
  }
}
