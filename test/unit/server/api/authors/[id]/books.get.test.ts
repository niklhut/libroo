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
} from '../../_helpers/api-route'

const route = routePath('authors/[id]/books.get')

describe('server/api/authors/[id]/books.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'author-1' } })

  it('gets an author library with sanitized pagination', async () => {
    mockLoggedInUser()
    const result = {
      author: { id: 'author-1', name: 'Octavia Butler' },
      items: [],
      pagination: { page: 1, pageSize: 100, total: 0, totalPages: 0 }
    }
    serviceMocks.getAuthorLibrary.mockReturnValueOnce(Effect.succeed(result))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'author-1' },
      query: { page: '-4', pageSize: '500' }
    }))).resolves.toBe(result)
    expect(serviceMocks.getAuthorLibrary).toHaveBeenCalledWith('user-1', 'author-1', { page: 1, pageSize: 100 })
  })

  it('rejects missing author ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      message: 'Author ID is required'
    })
  })
})
