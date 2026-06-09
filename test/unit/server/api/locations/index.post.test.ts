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

const route = routePath('locations/index.post')

describe('server/api/locations/index.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { body: { name: 'Shelf B', parentLocationId: null } })

  it('creates a nested location', async () => {
    mockLoggedInUser()
    const location = { id: 'loc-2', name: 'Section A', parentLocationId: 'loc-1', path: 'Shelf B - Section A', depth: 1 }
    serviceMocks.createLocation.mockReturnValueOnce(Effect.succeed(location))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { name: ' Section A ', parentLocationId: 'loc-1' } }))).resolves.toBe(location)
    expect(serviceMocks.createLocation).toHaveBeenCalledWith('user-1', { name: 'Section A', parentLocationId: 'loc-1' })
  })

  it('rejects invalid locations', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { name: '   ' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid location'
    })
  })
})
