import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  runEffect: vi.fn(),
  config: { enabled: true, maxRequests: 2, windowSeconds: 60 }
}))

vi.mock('h3', () => ({
  createError: ({ statusCode, message }: { statusCode: number, message: string }) => Object.assign(new Error(message), { statusCode }),
  defineEventHandler: (handler: unknown) => handler,
  getRequestIP: (event: { ip?: string }) => event.ip,
  setHeader: (event: { responseHeaders: Record<string, string> }, key: string, value: string | number) => { event.responseHeaders[key] = String(value) }
}))

vi.mock('../../../../server/utils/auth', () => ({
  LIBROO_CLIENT_IP_HEADER: 'x-libroo-client-ip',
  getTrustedIpHeaders: () => ['x-real-ip', 'x-libroo-client-ip'],
  auth: { api: { getSession: mocks.getSession } }
}))

vi.mock('../../../../server/utils/effect', () => ({
  runEffect: mocks.runEffect
}))

vi.mock('../../../../server/services/db.service', () => ({ DbService: Symbol('DbService') }))

vi.mock('../../../../server/utils/database-rate-limiter', () => ({
  DatabaseRateLimiter: class {
    consume() { return mocks.runEffect() }
  },
  redactKey: (key: string) => key
}))

vi.mock('../../../../server/utils/books-config', () => ({
  getBooksRateLimitConfig: () => mocks.config,
  getBulkLookupRateLimitConfig: () => ({ ...mocks.config, maxRequests: 1 })
}))

describe('server/middleware/01.books-rate-limit', () => {
  beforeEach(() => {
    mocks.getSession.mockReset()
    mocks.getSession.mockResolvedValue(null)
    mocks.runEffect.mockReset()
    mocks.runEffect.mockResolvedValue({ allowed: true, retryAfterSeconds: 60 })
    mocks.config = { enabled: true, maxRequests: 2, windowSeconds: 60 }
  })

  it('only applies to book lookup and add routes', async () => {
    const middleware = await import('../../../../server/middleware/01.books-rate-limit')

    expect(middleware.shouldEnforceRateLimit(makeEvent('/api/books/lookup'))).toBe(true)
    expect(middleware.shouldEnforceRateLimit(makeEvent('/api/books'))).toBe(true)
    expect(middleware.shouldEnforceRateLimit(makeEvent('/api/books/bulk-lookup'))).toBe(true)
    expect(middleware.shouldEnforceRateLimit(makeEvent('/api/books/bulk-add'))).toBe(false)
    expect(middleware.shouldEnforceRateLimit(makeEvent('/api/books/lookup', 'GET'))).toBe(false)
  })

  it('uses the dedicated bulk lookup limit', async () => {
    const middleware = await import('../../../../server/middleware/01.books-rate-limit')
    const event = makeEvent('/api/books/bulk-lookup')

    await middleware.default(event as never)
    expect(mocks.runEffect).toHaveBeenCalledOnce()
  })

  it('rejects requests over the limit with a user-facing 429', async () => {
    const middleware = await import('../../../../server/middleware/01.books-rate-limit')
    const event = makeEvent('/api/books/lookup', 'POST', 'over-limit')

    mocks.runEffect
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 60 })
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 60 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 60 })
    await expect(middleware.default(event as never)).resolves.toBeUndefined()
    await expect(middleware.default(event as never)).resolves.toBeUndefined()
    await expect(middleware.default(event as never)).rejects.toMatchObject({
      statusCode: 429,
      message: 'Too Many Requests'
    })
    expect(event.responseHeaders['Retry-After']).toBe('60')
  })

  it('bypasses rate limiting when disabled', async () => {
    mocks.config.enabled = false
    const middleware = await import('../../../../server/middleware/01.books-rate-limit')
    const event = makeEvent('/api/books/lookup', 'POST', 'disabled-limit')

    await expect(middleware.default(event as never)).resolves.toBeUndefined()
    await expect(middleware.default(event as never)).resolves.toBeUndefined()
    await expect(middleware.default(event as never)).resolves.toBeUndefined()
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('uses the authenticated user id instead of the client IP as the key', async () => {
    mocks.config.maxRequests = 1
    mocks.getSession
      .mockResolvedValueOnce({ user: { id: 'ada' } })
      .mockResolvedValueOnce({ user: { id: 'grace' } })
      .mockResolvedValueOnce({ user: { id: 'ada' } })
    const middleware = await import('../../../../server/middleware/01.books-rate-limit')
    const event = makeEvent('/api/books/lookup', 'POST', 'shared-ip')

    await middleware.default(event as never)
    await middleware.default(event as never)
    await middleware.default(event as never)
    expect(mocks.runEffect).toHaveBeenCalledTimes(3)
  })

  it('falls back to the client IP when session lookup fails', async () => {
    mocks.config.maxRequests = 1
    mocks.getSession.mockRejectedValue(new Error('session unavailable'))
    const middleware = await import('../../../../server/middleware/01.books-rate-limit')
    const event = makeEvent('/api/books/lookup', 'POST', 'session-fallback')

    await middleware.default(event as never)
    await middleware.default(event as never)
    expect(mocks.runEffect).toHaveBeenCalledTimes(2)
  })

  it('uses trusted headers but never trusts x-libroo-client-ip directly', async () => {
    const middleware = await import('../../../../server/middleware/01.books-rate-limit')
    const event = makeEvent('/api/books', 'POST', '127.0.0.1')
    event.headers.set('x-real-ip', '198.51.100.4')
    expect(middleware.getBooksRateLimitKey(event as never)).toBe('ip:198.51.100.4')

    event.headers.delete('x-real-ip')
    expect(middleware.getBooksRateLimitKey(event as never)).toBe('ip:127.0.0.1')

    const unknownEvent = makeEvent('/api/books', 'POST', '')
    unknownEvent.headers.set('x-libroo-client-ip', '203.0.113.9')
    expect(middleware.getBooksRateLimitKey(unknownEvent as never)).toBe('ip:unknown')
  })
})

function makeEvent(path: string, method = 'POST', ip: string | undefined = '127.0.0.1') {
  return {
    path,
    method,
    ip,
    headers: new Headers(),
    responseHeaders: {} as Record<string, string>
  }
}
