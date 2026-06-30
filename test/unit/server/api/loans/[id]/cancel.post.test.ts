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

const route = routePath('loans/[id]/cancel.post')

describe('server/api/loans/[id]/cancel.post', () => {
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

  it('cancels a loan for the current owner', async () => {
    mockLoggedInUser()
    const loan = ownerLoan('loan-1')
    serviceMocks.cancelLoanForOwner.mockReturnValueOnce(Effect.succeed(loan))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loan-1' } }))).resolves.toBe(loan)
    expect(serviceMocks.cancelLoanForOwner).toHaveBeenCalledWith('loan-1', 'user-1')
  })

  it.each([
    ['wrong owner'],
    ['not found']
  ])('surfaces LoanNotFoundError as 404 for %s', async () => {
    mockLoggedInUser()
    serviceMocks.cancelLoanForOwner.mockReturnValueOnce(Effect.fail({
      _tag: 'LoanNotFoundError',
      loanId: 'loan-1',
      message: 'Loan not found'
    }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loan-1' } }))).rejects.toMatchObject({
      statusCode: 404
    })
  })

  it('surfaces LoanUnavailableError as 409 for accepted loans', async () => {
    mockLoggedInUser()
    serviceMocks.cancelLoanForOwner.mockReturnValueOnce(Effect.fail({
      _tag: 'LoanUnavailableError',
      loanId: 'loan-1',
      message: 'Loan is not cancelable'
    }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loan-1' } }))).rejects.toMatchObject({
      statusCode: 409
    })
  })
})

function ownerLoan(id: string) {
  return {
    id,
    userBookId: 'ub-1',
    borrowerDisplayName: 'Grace',
    acceptedByName: null,
    status: 'canceled',
    loanedAt: new Date('2026-05-18T00:00:00.000Z'),
    dueAt: null,
    returnedAt: null,
    canceledAt: new Date('2026-05-19T00:00:00.000Z'),
    acceptedAt: null,
    book: { title: 'Example', author: 'Author', coverPath: null },
    inviteUrl: null
  }
}
