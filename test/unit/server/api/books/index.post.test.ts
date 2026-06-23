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

const route = routePath('books/index.post')

describe('server/api/books/index.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { body: { isbn: '9780306406157' } })

  it('adds a book by ISBN', async () => {
    mockLoggedInUser()
    const book = { id: 'ub-1', title: 'A Book' }
    serviceMocks.addBookToLibrary.mockReturnValueOnce(Effect.succeed(book))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      body: {
        isbn: '978-0-306-40615-7'
      }
    }))).resolves.toBe(book)
    expect(serviceMocks.addBookToLibrary).toHaveBeenCalledWith('user-1', '9780306406157')
  })

  it('rejects invalid ISBN payloads', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { isbn: 'short' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
  })
})
