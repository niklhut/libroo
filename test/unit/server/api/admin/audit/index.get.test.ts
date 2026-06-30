import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupApiRouteTest,
  importRoute,
  itRejectsBannedUsers,
  itRequiresAuth,
  makeEvent,
  mockLoggedInAdmin,
  routePath,
  serviceMocks,
  setupApiRouteTest,
  testAdminUser
} from '../../_helpers/api-route'

const route = routePath('admin/audit/index.get')

describe('server/api/admin/audit/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)
  itRejectsBannedUsers(route)

  it('lists admin audit entries with forwarded query pagination and category', async () => {
    mockLoggedInAdmin()
    const page = { entries: [], total: 0, page: 2, pageSize: 10 }
    serviceMocks.listAdminAuditEntries.mockReturnValueOnce(Effect.succeed(page))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      query: {
        page: '2',
        pageSize: '10',
        category: 'admin'
      }
    }))).resolves.toBe(page)
    expect(serviceMocks.listAdminAuditEntries).toHaveBeenCalledWith({
      actor: testAdminUser,
      page: '2',
      pageSize: '10',
      category: 'admin'
    })
  })

  it('maps admin permission failures to forbidden responses', async () => {
    mockLoggedInAdmin()
    serviceMocks.listAdminAuditEntries.mockReturnValueOnce(Effect.fail({ _tag: 'AdminForbiddenError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('maps invalid admin requests to bad request responses', async () => {
    mockLoggedInAdmin()
    serviceMocks.listAdminAuditEntries.mockReturnValueOnce(Effect.fail({ _tag: 'InvalidAdminRequestError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
  })
})
