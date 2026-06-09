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

const route = routePath('locations/index.get')

describe('server/api/locations/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)

  it('lists locations for the current user', async () => {
    mockLoggedInUser()
    const locations = [{ id: 'loc-1', name: 'Shelf B', parentLocationId: null, path: 'Shelf B', depth: 0, bookCount: 2 }]
    serviceMocks.listLocations.mockReturnValueOnce(Effect.succeed(locations))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).resolves.toBe(locations)
    expect(serviceMocks.listLocations).toHaveBeenCalledWith('user-1')
  })
})
