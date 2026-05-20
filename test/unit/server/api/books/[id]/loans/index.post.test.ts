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

const route = routePath('books/[id]/loans/index.post')

describe('server/api/books/[id]/loans/index.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'ub-1' }, body: { borrowerDisplayName: 'Grace' } })

  it('creates a loan for a user book', async () => {
    mockLoggedInUser()
    const result = {
      loan: {
        id: 'loan-1',
        userBookId: 'ub-1',
        borrowerDisplayName: 'Grace',
        status: 'active',
        loanedAt: new Date('2026-05-18T00:00:00.000Z'),
        dueAt: null,
        returnedAt: null,
        canceledAt: null,
        acceptedAt: null,
        book: { title: 'Example', author: 'Author', coverPath: null },
        inviteUrl: '/i/token'
      },
      inviteUrl: '/i/token'
    }
    serviceMocks.createLoanForBook.mockReturnValueOnce(Effect.succeed(result))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      params: { id: 'ub-1' },
      body: { borrowerDisplayName: 'Grace', borrowerEmail: '', dueAt: null, ownerNote: '' }
    }))).resolves.toEqual(result)
    expect(serviceMocks.createLoanForBook).toHaveBeenCalledWith('ub-1', 'user-1', {
      borrowerDisplayName: 'Grace',
      borrowerEmail: null,
      dueAt: null,
      ownerNote: null
    })
  })

  it('rejects missing book ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { borrowerDisplayName: 'Grace' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Book ID is required'
    })
  })
})
