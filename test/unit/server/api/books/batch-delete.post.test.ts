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

const route = routePath('books/batch-delete.post')

describe('server/api/books/batch-delete.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { body: { ids: ['ub-1'] } })

  it('batch-deletes books', async () => {
    mockLoggedInUser()
    const result = { removedIds: ['ub-1'], failedIds: ['ub-2'] }
    serviceMocks.batchRemoveFromLibrary.mockReturnValueOnce(Effect.succeed(result))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { ids: ['ub-1', 'ub-2'] } }))).resolves.toBe(result)
    expect(serviceMocks.batchRemoveFromLibrary).toHaveBeenCalledWith(['ub-1', 'ub-2'], 'user-1')
  })

  it('rejects empty batch-delete requests', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { ids: [] } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
  })
})
