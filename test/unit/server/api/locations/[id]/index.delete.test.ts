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

const route = routePath('locations/[id]/index.delete')

describe('server/api/locations/[id]/index.delete', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'loc-1' }, query: { mode: 'clear' } })

  it('deletes a location with explicit block handling', async () => {
    mockLoggedInUser()
    serviceMocks.deleteLocation.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loc-1' }, query: { mode: 'block' } }))).resolves.toEqual({ success: true })
    expect(serviceMocks.deleteLocation).toHaveBeenCalledWith('user-1', 'loc-1', { mode: 'block' })
  })

  it('deletes a location with explicit clear handling', async () => {
    mockLoggedInUser()
    serviceMocks.deleteLocation.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loc-1' }, query: { mode: 'clear' } }))).resolves.toEqual({ success: true })
    expect(serviceMocks.deleteLocation).toHaveBeenCalledWith('user-1', 'loc-1', { mode: 'clear' })
  })

  it('deletes a location with explicit move handling', async () => {
    mockLoggedInUser()
    serviceMocks.deleteLocation.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'loc-1' },
      query: { mode: 'move', targetLocationId: 'loc-3' }
    }))).resolves.toEqual({ success: true })
    expect(serviceMocks.deleteLocation).toHaveBeenCalledWith('user-1', 'loc-1', { mode: 'move', targetLocationId: 'loc-3' })
  })
})
