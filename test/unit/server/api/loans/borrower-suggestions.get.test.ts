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

const route = routePath('loans/borrower-suggestions.get')

describe('server/api/loans/borrower-suggestions.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { query: { query: 'gr' } })

  it('lists suggestions only for the current owner', async () => {
    mockLoggedInUser()
    const suggestions = [{ displayName: 'Grace', email: 'grace@example.com', lastUsedAt: new Date('2026-06-24T10:00:00.000Z') }]
    serviceMocks.listBorrowerSuggestionsForOwner.mockReturnValueOnce(Effect.succeed(suggestions))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ query: { query: '  gr  ', ownerUserId: 'user-2' } }))).resolves.toBe(suggestions)
    expect(serviceMocks.listBorrowerSuggestionsForOwner).toHaveBeenCalledWith('user-1', 'gr')
  })

  it('rejects queries over the borrower name limit', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ query: { query: 'x'.repeat(121) } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
    expect(serviceMocks.listBorrowerSuggestionsForOwner).not.toHaveBeenCalled()
  })
})
