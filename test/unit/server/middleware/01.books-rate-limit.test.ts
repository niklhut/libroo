import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
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
  getTrustedIpHeaders: () => ['x-libroo-client-ip'],
  auth: { api: { getSession: mocks.getSession } }
}))

vi.mock('../../../../server/utils/books-config', () => ({
  getBooksRateLimitConfig: () => mocks.config
}))

describe('server/middleware/01.books-rate-limit', () => {
  beforeEach(() => {
    mocks.getSession.mockReset()
    mocks.getSession.mockResolvedValue(null)
    mocks.config = { enabled: true, maxRequests: 2, windowSeconds: 60 }
  })

  it('only applies to book lookup and add routes', async () => {
    const middleware = await import('../../../../server/middleware/01.books-rate-limit')

    expect(middleware.shouldEnforceRateLimit(makeEvent('/api/books/lookup'))).toBe(true)
    expect(middleware.shouldEnforceRateLimit(makeEvent('/api/books'))).toBe(true)
    expect(middleware.shouldEnforceRateLimit(makeEvent('/api/books/bulk-add'))).toBe(false)
    expect(middleware.shouldEnforceRateLimit(makeEvent('/api/books/lookup', 'GET'))).toBe(false)
  })

  it('rejects requests over the limit with a user-facing 429', async () => {
    const middleware = await import('../../../../server/middleware/01.books-rate-limit')
    const event = makeEvent('/api/books/lookup', 'POST', 'over-limit')

    await expect(middleware.default(event as never)).resolves.toBeUndefined()
    await expect(middleware.default(event as never)).resolves.toBeUndefined()
    await expect(middleware.default(event as never)).rejects.toMatchObject({
      statusCode: 429,
      message: 'Too Many Requests'
    })
    expect(event.responseHeaders['Retry-After']).toBe('60')
  })
})

function makeEvent(path: string, method = 'POST', ip = '127.0.0.1') {
  return {
    path,
    method,
    ip,
    headers: new Headers(),
    responseHeaders: {} as Record<string, string>
  }
}
