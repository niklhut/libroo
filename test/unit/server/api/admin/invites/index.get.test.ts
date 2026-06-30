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

const route = routePath('admin/invites/index.get')

describe('server/api/admin/invites/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)
  itRejectsBannedUsers(route)

  it('rejects logged-in non-admin users', async () => {
    mockLoggedInUser()
    serviceMocks.listSignupInvites.mockReturnValueOnce(Effect.fail({ _tag: 'SignupInviteForbiddenError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lists signup invites for the admin actor with sanitized pagination', async () => {
    mockLoggedInAdmin()
    const list = { invites: [], total: 0, page: 3, pageSize: 25 }
    serviceMocks.listSignupInvites.mockReturnValueOnce(Effect.succeed(list))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      query: {
        page: '3',
        pageSize: '25'
      }
    }))).resolves.toBe(list)
    expect(serviceMocks.listSignupInvites).toHaveBeenCalledWith(testAdminUser, {
      page: 3,
      pageSize: 25
    })
  })

  it('normalizes invalid pagination before listing signup invites', async () => {
    mockLoggedInAdmin()
    const list = { invites: [], total: 0, page: 1, pageSize: 25 }
    serviceMocks.listSignupInvites.mockReturnValueOnce(Effect.succeed(list))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      query: {
        page: '-3',
        pageSize: '500'
      }
    }))).resolves.toBe(list)
    expect(serviceMocks.listSignupInvites).toHaveBeenCalledWith(testAdminUser, {
      page: 1,
      pageSize: 100
    })
  })

  it('maps signup invite permission failures to forbidden responses', async () => {
    mockLoggedInAdmin()
    serviceMocks.listSignupInvites.mockReturnValueOnce(Effect.fail({ _tag: 'SignupInviteForbiddenError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 403 })
  })

  it('maps invalid signup invite requests to bad request responses', async () => {
    mockLoggedInAdmin()
    serviceMocks.listSignupInvites.mockReturnValueOnce(Effect.fail({ _tag: 'InvalidSignupInviteError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
  })
})
