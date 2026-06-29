import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupApiRouteTest, getAuthHandlerMock, importRoute, makeEvent, routePath, setupApiRouteTest } from '../_helpers/api-route'

const h3Mock = vi.hoisted(() => ({
  getRequestIP: vi.fn(() => undefined as string | undefined),
  toWebRequest: vi.fn(() => new Request('http://localhost/api/auth/get-session'))
}))

vi.mock('h3', () => ({
  createError: (input: { statusCode: number, message?: string, statusMessage?: string, data?: unknown }) => {
    const error = new Error(input.message ?? input.statusMessage ?? 'Error') as Error & {
      statusCode: number
      statusMessage?: string
      data?: unknown
    }
    error.statusCode = input.statusCode
    error.statusMessage = input.statusMessage ?? input.message
    error.data = input.data
    return error
  },
  defineEventHandler: (handler: unknown) => handler,
  getRequestIP: h3Mock.getRequestIP,
  toWebRequest: h3Mock.toWebRequest
}))

const route = routePath('auth/[...all]')

describe('server/api/auth/[...all]', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  it('delegates to Better Auth', async () => {
    const result = new Response(null, { status: 204 })
    const authHandler = getAuthHandlerMock()
    authHandler.mockResolvedValueOnce(result)
    const handler = await importRoute(route)
    const event = makeEvent()

    await expect(handler(event)).resolves.toBe(result)
    expect(authHandler.mock.calls[0]?.[0]).toBeInstanceOf(Request)
  })

  it('scopes Nitro Cloudflare waitUntil while Better Auth handles the request', async () => {
    const result = new Response(null, { status: 204 })
    const waitUntil = vi.fn()
    const backgroundTask = Promise.resolve()
    const authHandler = getAuthHandlerMock()
    const handler = await importRoute(route)
    const { getWaitUntil } = await import('../../../../../server/utils/execution-context')
    authHandler.mockImplementationOnce(async () => {
      getWaitUntil()?.(backgroundTask)
      return result
    })
    const event = makeEvent({
      context: {
        waitUntil
      }
    })

    await expect(handler(event)).resolves.toBe(result)

    expect(waitUntil).toHaveBeenCalledWith(backgroundTask)
  })

  it('strips caller-supplied internal client IP headers when no runtime IP is resolved', async () => {
    const result = new Response(null, { status: 204 })
    const request = new Request('http://localhost/api/auth/get-session', {
      headers: {
        'x-libroo-client-ip': '203.0.113.10'
      }
    })
    const authHandler = getAuthHandlerMock()
    authHandler.mockResolvedValueOnce(result)
    h3Mock.toWebRequest.mockReturnValueOnce(request)
    h3Mock.getRequestIP.mockReturnValueOnce(undefined)
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).resolves.toBe(result)
    const delegatedRequest = authHandler.mock.calls[0]?.[0] as Request
    expect(delegatedRequest.headers.get('x-libroo-client-ip')).toBeNull()
  })
})
