import { createError, defineEventHandler, getRequestIP, setHeader } from 'h3'
import { Effect } from 'effect'
import { auth, getTrustedIpHeaders, LIBROO_CLIENT_IP_HEADER } from '../utils/auth'
import { DbService } from '../services/db.service'
import { getBooksRateLimitConfig } from '../utils/books-config'
import { DatabaseRateLimiter, redactKey } from '../utils/database-rate-limiter'
import { runEffect } from '../utils/effect'

const BOOKS_RATE_LIMIT_PATHS = new Set(['/api/books/lookup', '/api/books'])

export function shouldEnforceRateLimit(event: { method?: string, path?: string }) {
  return event.method === 'POST' && BOOKS_RATE_LIMIT_PATHS.has(event.path ?? '')
}

export function getBooksRateLimitKey(event: Parameters<typeof getRequestIP>[0], userId?: string) {
  if (userId) return `user:${userId}`

  for (const header of getTrustedIpHeaders()) {
    // This header is an internal Better Auth hand-off, not a client-IP source.
    // Trusting it here would let a caller forge a distinct ISBN limit bucket.
    if (header.toLowerCase() === LIBROO_CLIENT_IP_HEADER) continue
    const value = event.headers.get(header)?.split(',')[0]?.trim()
    if (value) return `ip:${value}`
  }

  const resolvedIp = getRequestIP(event)
  if (resolvedIp) return `ip:${resolvedIp}`

  // Do not trust client-controlled headers when no runtime/trusted IP is known.
  // A shared unknown bucket fails safely rather than allowing easy evasion.
  return 'ip:unknown'
}

export default defineEventHandler(async (event) => {
  if (!shouldEnforceRateLimit(event)) return

  const config = getBooksRateLimitConfig()
  if (!config.enabled) return

  let userId: string | undefined
  try {
    const session = await auth.api.getSession({ headers: event.headers })
    userId = session?.user?.id
  } catch {
    // Rate limiting remains available by IP if session resolution is unavailable.
  }
  const key = getBooksRateLimitKey(event, userId)
  let result
  try {
    result = await runEffect(Effect.gen(function* () {
      const dbService = yield* DbService
      return yield* Effect.tryPromise(() =>
        new DatabaseRateLimiter(dbService).consume(key, config.maxRequests, config.windowSeconds)
      )
    }))
  } catch (error) {
    // ISBN mutations fail closed when the authoritative shared counter is down.
    console.error('books-rate-limit failure', {
      component: 'books-rate-limit', severity: 'error', operation: 'consume', path: event.path,
      key: redactKey(key), limit: config.maxRequests, windowSeconds: config.windowSeconds,
      error: error instanceof Error ? error.message : String(error)
    })
    throw createError({ statusCode: 503, message: 'Rate limiting is temporarily unavailable' })
  }

  console.warn('books-rate-limit decision', {
    component: 'books-rate-limit', outcome: result.allowed ? 'allow' : 'deny', path: event.path,
    key: redactKey(key), limit: config.maxRequests, windowSeconds: config.windowSeconds,
    retryAfterSeconds: result.retryAfterSeconds
  })

  if (!result.allowed) {
    setHeader(event, 'Retry-After', result.retryAfterSeconds)
    throw createError({ statusCode: 429, message: 'Too Many Requests' })
  }
})
