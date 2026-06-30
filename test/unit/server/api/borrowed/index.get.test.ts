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

const route = routePath('borrowed/index.get')

describe('server/api/borrowed/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)

  it('lists books lent to the current user', async () => {
    mockLoggedInUser()
    const borrowedBooks = [{
      id: 'loan-1',
      status: 'active',
      title: 'Example',
      author: 'Author',
      coverPath: null,
      ownerName: 'Owner',
      loanedAt: new Date('2026-05-18T00:00:00.000Z'),
      dueAt: null,
      returnedAt: null,
      acceptedAt: new Date('2026-05-18T01:00:00.000Z'),
      ownerRemoved: false
    }]
    serviceMocks.listBooksLentToUser.mockReturnValueOnce(Effect.succeed(borrowedBooks))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).resolves.toBe(borrowedBooks)
    expect(serviceMocks.listBooksLentToUser).toHaveBeenCalledWith('user-1')
  })
})
