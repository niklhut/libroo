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
  setupApiRouteTest
} from '../../_helpers/api-route'

const route = routePath('admin/users/index.get')

describe('server/api/admin/users/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)
  itRejectsBannedUsers(route)

  it('rejects logged-in non-admin users', async () => {
    mockLoggedInUser()
    serviceMocks.listAdminUsers.mockReturnValueOnce(Effect.fail({ _tag: 'AdminForbiddenError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists admin users with forwarded request headers and query pagination', async () => {
    mockLoggedInAdmin()
    const headers = new Headers({ 'x-admin-request': '1' })
    const page = { users: [], total: 0, page: 4, pageSize: 50 }
    serviceMocks.listAdminUsers.mockReturnValueOnce(Effect.succeed(page))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      headers,
      query: {
        page: '4',
        pageSize: '50'
      }
    }))).resolves.toBe(page)
    expect(serviceMocks.listAdminUsers).toHaveBeenCalledWith({
      headers,
      page: 4,
      pageSize: 50
    })
  })

  it('maps admin permission failures to forbidden responses', async () => {
    mockLoggedInAdmin()
    serviceMocks.listAdminUsers.mockReturnValueOnce(Effect.fail({ _tag: 'AdminForbiddenError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('returns the listAdminUsers result without reshaping it', async () => {
    mockLoggedInAdmin()
    const adminUser = {
      id: 'user-2',
      name: 'Grace',
      email: 'grace@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z',
      lastActiveAt: null,
      role: 'admin',
      isAdmin: true,
      status: 'active',
      banReason: null,
      banExpires: null
    }
    const page = {
      users: [adminUser],
      total: 1,
      page: 1,
      pageSize: 25
    }
    serviceMocks.listAdminUsers.mockReturnValueOnce(Effect.succeed(page))
    const handler = await importRoute(route)

    const response = await handler(makeEvent())

    expect(response).toBe(page)
    expect(new Set(Object.keys(response as typeof page))).toEqual(new Set(['users', 'total', 'page', 'pageSize']))
    expect(new Set(Object.keys((response as typeof page).users[0]))).toEqual(new Set([
      'id',
      'name',
      'email',
      'createdAt',
      'updatedAt',
      'lastActiveAt',
      'role',
      'isAdmin',
      'status',
      'banReason',
      'banExpires'
    ]))
    expect((response as typeof page).users[0]).not.toHaveProperty('password')
    expect((response as typeof page).users[0]).not.toHaveProperty('passwordHash')
    expect((response as typeof page).users[0]).not.toHaveProperty('hash')
    expect((response as typeof page).users[0]).not.toHaveProperty('token')
  })
})
