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
} from '../../../../_helpers/api-route'

const route = routePath('books/[id]/tags/[tagId]/promote.post')

describe('server/api/books/[id]/tags/[tagId]/promote.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1', tagId: 'tag-1' } })

  it('promotes a suggested tag', async () => {
    mockLoggedInUser()
    serviceMocks.promoteSuggestedTag.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1', tagId: 'tag-1' } }))).resolves.toEqual({ success: true })
    expect(serviceMocks.promoteSuggestedTag).toHaveBeenCalledWith('ub-1', 'user-1', 'tag-1')
  })

  it('rejects missing route ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Book ID and Tag ID are required'
    })
  })
})
