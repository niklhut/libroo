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

const route = routePath('books/[id]/state.put')

describe('server/api/books/[id]/state.put', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1' }, body: { state: 'owned' } })

  it('updates library state', async () => {
    mockLoggedInUser()
    const book = { id: 'ub-1', libraryState: 'owned' }
    serviceMocks.updateLibraryState.mockReturnValueOnce(Effect.succeed(book))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'ub-1' },
      body: { state: 'owned' }
    }))).resolves.toEqual({ success: true, book })

    expect(serviceMocks.updateLibraryState).toHaveBeenCalledWith('ub-1', 'user-1', 'owned')
  })

  it('rejects invalid state payloads', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'ub-1' },
      body: { state: 'missing' }
    }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid library state'
    })
  })
})
