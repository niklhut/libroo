import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupApiRouteTest, getAuthHandlerMock, importRoute, makeEvent, routePath, setupApiRouteTest } from '../_helpers/api-route'

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
