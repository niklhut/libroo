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

const route = routePath('locations/[id]/rename.put')

describe('server/api/locations/[id]/rename.put', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'loc-1' }, body: { name: 'Shelf C' } })

  it('renames a location for the current user', async () => {
    mockLoggedInUser()
    const location = { id: 'loc-1', name: 'Shelf C', parentLocationId: null, path: 'Shelf C', depth: 0 }
    serviceMocks.renameLocation.mockReturnValueOnce(Effect.succeed(location))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loc-1' }, body: { name: ' Shelf C ' } }))).resolves.toBe(location)
    expect(serviceMocks.renameLocation).toHaveBeenCalledWith('user-1', 'loc-1', { name: 'Shelf C' })
  })
})
