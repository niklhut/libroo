import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupApiRouteTest,
  importRoute,
  itRejectsBannedUsers,
  itRequiresAuth,
  makeEvent,
  mockLoggedInUser,
  routePath,
  serviceMocks,
  setupApiRouteTest
} from '../_helpers/api-route'

const route = routePath('books/index.get')

describe('server/api/books/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)
  itRejectsBannedUsers(route)

  it('lists the user library with sanitized pagination, search, and filters', async () => {
    mockLoggedInUser()
    const result = { items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 } }
    serviceMocks.getUserLibrary.mockReturnValueOnce(Effect.succeed(result))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      query: {
        page: '-2',
        pageSize: '500',
        search: '  dune  ',
        loanStatus: 'loaned',
        readingStatus: 'read',
        tag: ' classic ',
        location: ' Shelf B ',
        locationId: ' loc-1 ',
        includeLocationDescendants: 'true',
        sortBy: 'locationPath'
      }
    }))).resolves.toBe(result)
    expect(serviceMocks.getUserLibrary).toHaveBeenCalledWith('user-1', {
      page: 1,
      pageSize: 100,
      search: 'dune',
      libraryState: 'all',
      loanStatus: 'loaned',
      readingStatus: 'read',
      tag: 'classic',
      location: 'Shelf B',
      locationId: 'loc-1',
      includeLocationDescendants: true,
      sortBy: 'locationPath'
    })
  })
})
