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

const route = routePath('books/[id]/note.put')

describe('server/api/books/[id]/note.put', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1' }, body: { note: 'Nice' } })

  it('updates a book note after trimming blank strings to null', async () => {
    mockLoggedInUser()
    serviceMocks.updateNote.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: { note: '   ' } }))).resolves.toEqual({ success: true })
    expect(serviceMocks.updateNote).toHaveBeenCalledWith('ub-1', 'user-1', null)
  })

  it('rejects missing book ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { note: 'Nice' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Book ID is required'
    })
  })

  it('rejects invalid notes', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'ub-1' }, body: { note: 42 } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invalid note'
    })
  })
})
