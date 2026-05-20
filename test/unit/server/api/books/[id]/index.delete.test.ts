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

const route = routePath('books/[id]/index.delete')

describe('server/api/books/[id]/index.delete', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1' } })

  it('deletes one book by id', async () => {
    mockLoggedInUser()
    serviceMocks.removeBookFromLibrary.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' } }))).resolves.toEqual({ success: true })
    expect(serviceMocks.removeBookFromLibrary).toHaveBeenCalledWith('ub-1', 'user-1', { confirmActiveLoan: false })
  })

  it('passes active-loan removal confirmation', async () => {
    mockLoggedInUser()
    serviceMocks.removeBookFromLibrary.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'ub-1' },
      query: { confirmActiveLoan: 'true' }
    }))).resolves.toEqual({ success: true })
    expect(serviceMocks.removeBookFromLibrary).toHaveBeenCalledWith('ub-1', 'user-1', { confirmActiveLoan: true })
  })

  it('rejects missing book ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      message: 'Book ID is required'
    })
  })
})
