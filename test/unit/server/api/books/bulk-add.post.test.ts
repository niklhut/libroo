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
    serviceMocks.bulkAddBooks.mockReturnValueOnce(Effect.succeed({
      added: [{ isbn: '9780306406157' }],
      failed: [{ isbn: '9780306406158', error: 'BookAlreadyOwnedError' }]
    }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      body: {
        books: [
          { isbn: '9780306406157', previewCoverPath: 'covers/9780306406157.webp' },
          { isbn: '9780306406158' }
        ]
      }
    }))).resolves.toEqual({
      added: [{ isbn: '9780306406157' }],
      failed: [{ isbn: '9780306406158', error: 'BookAlreadyOwnedError' }]
    })
    expect(serviceMocks.bulkAddBooks).toHaveBeenCalledWith('user-1', [
      { isbn: '9780306406157', previewCoverPath: 'covers/9780306406157.webp' },
      { isbn: '9780306406158' }
    ])
  })

  it('rejects empty bulk-add requests', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { isbns: [] } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
  })

  it('rejects requests that mix legacy ISBNs and book objects', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      body: {
        isbns: ['9780306406158'],
        books: [{ isbn: '9780306406157', previewCoverPath: 'covers/9780306406157.webp' }]
      }
    }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
  })
})
