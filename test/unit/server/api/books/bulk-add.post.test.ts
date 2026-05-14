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

const route = routePath('books/bulk-add.post')

describe('server/api/books/bulk-add.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { body: { isbns: ['9780306406157'] } })

  it('bulk-adds ISBNs and reports per-item failures', async () => {
    mockLoggedInUser()
    serviceMocks.addBookToLibrary
      .mockReturnValueOnce(Effect.succeed({ id: 'ub-1' }))
      .mockReturnValueOnce(Effect.fail({ _tag: 'BookAlreadyOwnedError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { isbns: ['9780306406157', '9780306406158'] } }))).resolves.toEqual({
      added: [{ isbn: '9780306406157' }],
      failed: [{ isbn: '9780306406158', error: 'BookAlreadyOwnedError' }]
    })
  })

  it('rejects empty bulk-add requests', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { isbns: [] } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
  })
})
