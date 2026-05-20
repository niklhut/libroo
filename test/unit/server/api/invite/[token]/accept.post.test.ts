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

const route = routePath('invite/[token]/accept.post')

describe('server/api/invite/[token]/accept.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { token: 'token-1' } })

  it('accepts a book invite for the signed-in user', async () => {
    mockLoggedInUser()
    const borrowed = {
      id: 'loan-1',
      status: 'active',
      title: 'Example',
      author: 'Author',
      coverPath: null,
      ownerName: 'Ada',
      loanedAt: new Date('2026-05-18T00:00:00.000Z'),
      dueAt: null,
      returnedAt: null,
      acceptedAt: new Date('2026-05-18T00:00:00.000Z'),
      ownerRemoved: false
    }
    serviceMocks.acceptBookInvite.mockReturnValueOnce(Effect.succeed(borrowed))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { token: 'token-1' } }))).resolves.toEqual(borrowed)
    expect(serviceMocks.acceptBookInvite).toHaveBeenCalledWith('token-1', 'user-1')
  })
})
