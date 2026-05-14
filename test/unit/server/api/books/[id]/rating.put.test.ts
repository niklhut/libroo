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

const route = routePath('books/[id]/rating.put')

describe('server/api/books/[id]/rating.put', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1' }, body: { rating: 5 } })

  it('updates a book rating', async () => {
    mockLoggedInUser()
    serviceMocks.updateRating.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: { rating: 4 } }))).resolves.toEqual({ success: true })
    expect(serviceMocks.updateRating).toHaveBeenCalledWith('ub-1', 'user-1', 4)
  })

  it('rejects missing book ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { rating: 4 } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Book ID is required'
    })
  })

  it('rejects invalid ratings', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: { rating: 6 } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid rating'
    })
  })
})
