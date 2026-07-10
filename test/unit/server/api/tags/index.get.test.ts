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

const route = routePath('tags/index.get')

describe('server/api/tags/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)

  it('lists tags for the current user', async () => {
    mockLoggedInUser()
    const tags = [{ id: 'tag-1', name: 'Fiction', bookCount: 2 }]
    serviceMocks.listTags.mockReturnValueOnce(Effect.succeed(tags))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).resolves.toBe(tags)
    expect(serviceMocks.listTags).toHaveBeenCalledWith('user-1')
  })
})
