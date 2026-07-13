import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupApiRouteTest, importRoute, itRequiresAuth, makeEvent, mockLoggedInUser, routePath, serviceMocks, setupApiRouteTest } from '../../_helpers/api-route'

const route = routePath('loans/[id]/invite-email.post')

describe('server/api/loans/[id]/invite-email.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'loan-1' }, body: { token: 'token' } })

  it('delegates an invite email resend to the lending service', async () => {
    mockLoggedInUser()
    serviceMocks.resendLoanInviteForOwner.mockReturnValueOnce(Effect.succeed({ deliveryStatus: 'sent' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loan-1' }, body: { token: 'token' } }))).resolves.toEqual({ deliveryStatus: 'sent' })
    expect(serviceMocks.resendLoanInviteForOwner).toHaveBeenCalledWith('loan-1', 'user-1', 'token')
  })

  it('rejects missing loan ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { token: 'token' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Loan ID is required'
    })
  })

  it('rejects missing invite tokens', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'loan-1' }, body: {} }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
  })
})
