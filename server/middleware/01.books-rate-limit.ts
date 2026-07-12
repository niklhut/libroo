import { createError, defineEventHandler, getRequestIP, setHeader } from 'h3'
import { auth, getTrustedIpHeaders, LIBROO_CLIENT_IP_HEADER } from '../utils/auth'
import { getBooksRateLimitConfig } from '../utils/books-config'
import { checkFixedWindowRateLimit, InMemoryFixedWindowRateLimitStore } from '../utils/rate-limit'

const rateLimitStore = new InMemoryFixedWindowRateLimitStore()
const BOOKS_RATE_LIMIT_PATHS = new Set(['/api/books/lookup', '/api/books'])

export function shouldEnforceRateLimit(event: { method?: string, path?: string }) {
  return event.method === 'POST' && BOOKS_RATE_LIMIT_PATHS.has(event.path ?? '')
}

export function getBooksRateLimitKey(event: Parameters<typeof getRequestIP>[0], userId?: string) {
  if (userId) return `user:${userId}`

  const resolvedIp = getRequestIP(event)
  if (resolvedIp) return `ip:${resolvedIp}`

  for (const header of getTrustedIpHeaders()) {
    const value = event.headers.get(header)?.split(',')[0]?.trim()
    if (value) return `ip:${value}`
  }

  return `ip:${event.headers.get(LIBROO_CLIENT_IP_HEADER) ?? 'unknown'}`
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
  const result = checkFixedWindowRateLimit(
    rateLimitStore,
    getBooksRateLimitKey(event, userId),
    config.maxRequests,
    config.windowSeconds
  )

  if (!result.allowed) {
    setHeader(event, 'Retry-After', result.retryAfterSeconds)
    throw createError({ statusCode: 429, message: 'Too Many Requests' })
  }
})
