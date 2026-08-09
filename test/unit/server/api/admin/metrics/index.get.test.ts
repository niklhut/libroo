import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupApiRouteTest,
  importRoute,
  itRejectsBannedUsers,
  itRequiresAuth,
  makeEvent,
  mockLoggedInAdmin,
  mockLoggedInUser,
  routePath,
  serviceMocks,
  setupApiRouteTest,
  testAdminUser
} from '../../_helpers/api-route'

const route = routePath('admin/metrics/index.get')

describe('server/api/admin/metrics/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)
  itRejectsBannedUsers(route)

  it('maps non-admin actors to forbidden responses', async () => {
    mockLoggedInUser()
    serviceMocks.getAdminMetrics.mockReturnValueOnce(Effect.fail({ _tag: 'AdminForbiddenError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns metrics for an admin actor', async () => {
    mockLoggedInAdmin()
    const metrics = {
      users: 2,
      library: { canonicalBooks: 3, activeUserBooks: 4, activeLoans: 1, locations: 2, tags: 5 },
      storage: { state: 'unavailable' as const }
    }
    serviceMocks.getAdminMetrics.mockReturnValueOnce(Effect.succeed(metrics))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).resolves.toBe(metrics)
    expect(serviceMocks.getAdminMetrics).toHaveBeenCalledWith({
      actor: testAdminUser,
      headers: expect.any(Headers)
    })
  })
})
