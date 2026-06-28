import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupApiRouteTest, getAuthHandlerMock, importRoute, makeEvent, routePath, setupApiRouteTest } from '../_helpers/api-route'

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
  getRequestIP: () => undefined,
  toWebRequest: (event: unknown) => ({ webRequestFor: event })
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
    expect(authHandler).toHaveBeenCalledWith({ webRequestFor: event })
  })
})
