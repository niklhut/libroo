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

const route = routePath('books/[id]/location.put')

describe('server/api/books/[id]/location.put', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1' }, body: { locationId: 'loc-1' } })

  it('updates a book location', async () => {
    mockLoggedInUser()
    const location = { id: 'loc-1', name: 'Shelf-B', parentLocationId: 'loc-0', path: 'Living Room - Shelf-B', depth: 1 }
    serviceMocks.updateLocation.mockReturnValueOnce(Effect.succeed(location))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: { locationId: 'loc-1' } }))).resolves.toEqual({
      success: true,
      location
    })
    expect(serviceMocks.updateLocation).toHaveBeenCalledWith('ub-1', 'user-1', 'loc-1')
  })

  it('clears a blank location', async () => {
    mockLoggedInUser()
    serviceMocks.updateLocation.mockReturnValueOnce(Effect.succeed(null))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: { locationId: null } }))).resolves.toEqual({
      success: true,
      location: null
    })
    expect(serviceMocks.updateLocation).toHaveBeenCalledWith('ub-1', 'user-1', null)
  })

  it('rejects missing book ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { locationId: 'loc-1' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Book ID is required'
    })
  })

  it('rejects invalid locations', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: { locationId: 42 } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid location'
    })
  })
})
