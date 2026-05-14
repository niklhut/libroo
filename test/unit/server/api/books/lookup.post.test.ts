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

const route = routePath('books/lookup.post')

describe('server/api/books/lookup.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { body: { isbn: '9780306406157' } })

  it('looks up a book by ISBN', async () => {
    mockLoggedInUser()
    const lookup = { found: true, isbn: '9780306406157', title: 'A Book' }
    serviceMocks.lookupBook.mockReturnValueOnce(Effect.succeed(lookup))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { isbn: '9780306406157' } }))).resolves.toBe(lookup)
    expect(serviceMocks.lookupBook).toHaveBeenCalledWith('user-1', '9780306406157')
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
