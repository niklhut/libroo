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

const route = routePath('loans/index.get')

describe('server/api/loans/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)

  it('lists loans for the current owner', async () => {
    mockLoggedInUser()
    const loans = [{
      id: 'loan-1',
      userBookId: 'ub-1',
      borrowerDisplayName: 'Grace',
      acceptedByName: null,
      status: 'active',
      loanedAt: new Date('2026-05-18T00:00:00.000Z'),
      dueAt: null,
      returnedAt: null,
      canceledAt: null,
      acceptedAt: null,
      book: { title: 'Example', author: 'Author', coverPath: null },
      inviteUrl: null
    }]
    serviceMocks.listLoansForOwner.mockReturnValueOnce(Effect.succeed(loans))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).resolves.toBe(loans)
    expect(serviceMocks.listLoansForOwner).toHaveBeenCalledWith('user-1')
  })
})
