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

const route = routePath('books/[id]/index.get')

describe('server/api/books/[id]/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1' } })

  it('gets one book by id', async () => {
    mockLoggedInUser()
    const book = {
      id: 'ub-1',
      title: 'A Book',
      location: { id: 'loc-1', name: 'Shelf-B', parentLocationId: 'loc-0', path: 'Living Room - Shelf-B', depth: 1 },
      readingProgress: {
        status: 'reading',
        currentPage: 50,
        progressPercent: 25,
        startedAt: '2026-05-01T00:00:00.000Z',
        finishedAt: null
      }
    }
    serviceMocks.getBookDetails.mockReturnValueOnce(Effect.succeed(book))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' } }))).resolves.toBe(book)
    expect(serviceMocks.getBookDetails).toHaveBeenCalledWith('ub-1', 'user-1')
  })

  it('returns not found when the user cannot access the book id', async () => {
    mockLoggedInUser()
    serviceMocks.getBookDetails.mockReturnValueOnce(Effect.fail({
      _tag: 'BookNotFoundError',
      bookId: 'ub-other-user'
    }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-other-user' } }))).rejects.toMatchObject({
      statusCode: 404
    })
    expect(serviceMocks.getBookDetails).toHaveBeenCalledWith('ub-other-user', 'user-1')
  })

  it('rejects missing book ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      message: 'Book ID is required'
    })
  })
})
