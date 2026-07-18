import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOAN_NOTE_MAX_LENGTH } from '~~/shared/utils/loan'
import { cleanupApiRouteTest, importRoute, itRequiresAuth, makeEvent, mockLoggedInUser, routePath, serviceMocks, setupApiRouteTest } from '../../_helpers/api-route'

const route = routePath('loans/[id]/note.put')

describe('server/api/loans/[id]/note.put', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { id: 'loan-1' }, body: { note: 'Private' } })

  it('updates an owner loan note', async () => {
    mockLoggedInUser()
    serviceMocks.updateLoanNote.mockReturnValueOnce(Effect.succeed(undefined))
    const handler = await importRoute(route)
    await expect(handler(makeEvent({ params: { id: 'loan-1' }, body: { note: '  Private  ' } }))).resolves.toEqual({ success: true })
    expect(serviceMocks.updateLoanNote).toHaveBeenCalledWith('loan-1', 'user-1', 'Private')
  })

  it('rejects missing loan ids', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)
    await expect(handler(makeEvent({ body: { note: 'Private' } }))).rejects.toMatchObject({ statusCode: 400, message: 'Loan ID is required' })
  })

  it('rejects invalid or too-long notes', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)
    await expect(handler(makeEvent({ params: { id: 'loan-1' }, body: { note: 42 } }))).rejects.toMatchObject({ statusCode: 400, message: 'Invalid note' })
    await expect(handler(makeEvent({ params: { id: 'loan-1' }, body: { note: 'x'.repeat(LOAN_NOTE_MAX_LENGTH + 1) } }))).rejects.toMatchObject({ statusCode: 400, message: 'Invalid note' })
  })
})
