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
} from '../../_helpers/api-route'

const route = routePath('locations/[id]/move.put')

describe('server/api/locations/[id]/move.put', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'loc-2' }, body: { parentLocationId: null } })

  it('moves a location for the current user', async () => {
    mockLoggedInUser()
    const location = { id: 'loc-2', name: 'Shelf C', parentLocationId: 'loc-1', path: 'Room - Shelf C', depth: 1 }
    serviceMocks.moveLocation.mockReturnValueOnce(Effect.succeed(location))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loc-2' }, body: { parentLocationId: 'loc-1' } }))).resolves.toBe(location)
    expect(serviceMocks.moveLocation).toHaveBeenCalledWith('user-1', 'loc-2', { parentLocationId: 'loc-1' })
  })
})
