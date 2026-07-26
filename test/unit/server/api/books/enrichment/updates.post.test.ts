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
} from '../../_helpers/api-route'

const route = routePath('books/enrichment/updates.post')

describe('server/api/books/enrichment/updates.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { body: { ids: ['user-book-1'] } })
  itRejectsBannedUsers(route, { body: { ids: ['user-book-1'] } })

  it('returns silent card updates only for the authenticated user', async () => {
    mockLoggedInUser({ id: 'session-user', name: 'Ada', email: 'ada@example.com' })
    const updates = [{ userBookId: 'user-book-1', coverPath: 'covers/book.webp', status: null }]
    serviceMocks.getBookEnrichmentUpdates.mockReturnValueOnce(Effect.succeed(updates))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { ids: ['user-book-1'] } }))).resolves.toBe(updates)
    expect(serviceMocks.getBookEnrichmentUpdates).toHaveBeenCalledWith('session-user', ['user-book-1'])
  })
})
