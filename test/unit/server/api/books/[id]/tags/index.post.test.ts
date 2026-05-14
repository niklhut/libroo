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
} from '../../../_helpers/api-route'

const route = routePath('books/[id]/tags/index.post')

describe('server/api/books/[id]/tags/index.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1' }, body: { name: 'favorite' } })

  it('adds a user tag', async () => {
    mockLoggedInUser()
    const tag = { id: 'tag-1', name: 'favorite' }
    serviceMocks.addUserTag.mockReturnValueOnce(Effect.succeed(tag))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: { name: ' Favorite ' } }))).resolves.toEqual({ success: true, tag })
    expect(serviceMocks.addUserTag).toHaveBeenCalledWith('ub-1', 'user-1', 'Favorite')
  })

  it('rejects missing book ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { name: 'favorite' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Book ID is required'
    })
  })

  it('rejects invalid tag names', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: { name: '1234' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
  })
})
