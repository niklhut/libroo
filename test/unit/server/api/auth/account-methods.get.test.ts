import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupApiRouteTest,
  importRoute,
  itRequiresAuth,
  makeEvent,
  mockLoggedInUser,
  routePath,
  serviceMocks,
  setupApiRouteTest
} from '../_helpers/api-route'

const route = routePath('auth/account-methods.get')

describe('server/api/auth/account-methods.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)

  it('returns uncached account methods scoped to each session user', async () => {
    const handler = await importRoute(route)
    const firstEvent = makeEvent()
    const secondEvent = makeEvent()

    mockLoggedInUser({ id: 'user-1', name: 'Ada', email: 'ada@example.com' })
    serviceMocks.getAccountMethodStatus.mockReturnValueOnce(Effect.succeed({
      hasPasswordCredential: true,
      oidcProviderLinked: false
    }))
    await expect(handler(firstEvent)).resolves.toEqual({
      hasPasswordCredential: true,
      oidcProviderLinked: false
    })

    mockLoggedInUser({ id: 'user-2', name: 'Bea', email: 'bea@example.com' })
    serviceMocks.getAccountMethodStatus.mockReturnValueOnce(Effect.succeed({
      hasPasswordCredential: false,
      oidcProviderLinked: true
    }))
    await expect(handler(secondEvent)).resolves.toEqual({
      hasPasswordCredential: false,
      oidcProviderLinked: true
    })

    expect(serviceMocks.getAccountMethodStatus).toHaveBeenNthCalledWith(1, 'user-1')
    expect(serviceMocks.getAccountMethodStatus).toHaveBeenNthCalledWith(2, 'user-2')
    expect(firstEvent.responseHeaders['Cache-Control']).toBe('private, no-store')
    expect(secondEvent.responseHeaders['Cache-Control']).toBe('private, no-store')
  })
})
