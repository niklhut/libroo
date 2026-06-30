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
  setupApiRouteTest
} from '../../../_helpers/api-route'

const route = routePath('admin/invites/[id]/revoke.post')

describe('server/api/admin/invites/[id]/revoke.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)
  itRejectsBannedUsers(route)

  it('revokes a signup invite for the admin actor', async () => {
    mockLoggedInAdmin()
    const invite = {
      id: 'invite-1',
      email: null,
      status: 'revoked',
      createdByUserId: 'user-1',
      acceptedByUserId: null,
      expiresAt: '2026-07-14T00:00:00.000Z',
      acceptedAt: null,
      revokedAt: '2026-06-30T00:00:00.000Z',
      createdAt: '2026-06-30T00:00:00.000Z',
      updatedAt: '2026-06-30T00:00:00.000Z'
    }
    serviceMocks.revokeSignupInvite.mockReturnValueOnce(Effect.succeed(invite))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'invite-1' } }))).resolves.toBe(invite)
    expect(serviceMocks.revokeSignupInvite).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'invite-1')
  })

  it('rejects missing invite ids before calling the service', async () => {
    mockLoggedInAdmin()
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
    expect(serviceMocks.revokeSignupInvite).not.toHaveBeenCalled()
  })

  it('maps signup invite permission failures to forbidden responses', async () => {
    mockLoggedInAdmin()
    serviceMocks.revokeSignupInvite.mockReturnValueOnce(Effect.fail({ _tag: 'SignupInviteForbiddenError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { id: 'invite-1' } }))).rejects.toMatchObject({ statusCode: 403 })
  })
})
