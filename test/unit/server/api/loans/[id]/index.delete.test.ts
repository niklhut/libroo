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

const route = routePath('loans/[id]/index.delete')

describe('server/api/loans/[id]/index.delete', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'loan-1' } })

  it('rejects missing loan ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      message: 'Loan ID is required'
    })
  })

  it('deletes a closed loan for the current owner', async () => {
    mockLoggedInUser()
    serviceMocks.deleteLoanForOwner.mockReturnValueOnce(Effect.succeed({}))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loan-1' } }))).resolves.toEqual({ success: true })
    expect(serviceMocks.deleteLoanForOwner).toHaveBeenCalledWith('loan-1', 'user-1')
  })

  it('surfaces LoanNotFoundError as 404', async () => {
    mockLoggedInUser()
    serviceMocks.deleteLoanForOwner.mockReturnValueOnce(Effect.fail({
      _tag: 'LoanNotFoundError',
      loanId: 'loan-1',
      message: 'Loan not found'
    }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loan-1' } }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('surfaces LoanUnavailableError as 409 for active loans', async () => {
    mockLoggedInUser()
    serviceMocks.deleteLoanForOwner.mockReturnValueOnce(Effect.fail({
      _tag: 'LoanUnavailableError',
      message: 'Active loans cannot be deleted'
    }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loan-1' } }))).rejects.toMatchObject({ statusCode: 409 })
  })
})
