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

const route = routePath('admin/invites/index.post')

describe('server/api/admin/invites/index.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route)
  itRejectsBannedUsers(route)

  it('rejects logged-in non-admin users', async () => {
    mockLoggedInUser()
    serviceMocks.createSignupInvite.mockReturnValueOnce(Effect.fail({ _tag: 'SignupInviteForbiddenError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: {} }))).rejects.toMatchObject({ statusCode: 403 })
  })

  it('creates a signup invite with sanitized request body fields', async () => {
    mockLoggedInAdmin()
    const body = { email: ' Grace@Example.com ', expiresInDays: '14' }
    const createResult = {
      invite: {
        id: 'invite-1',
        email: 'grace@example.com',
        status: 'pending',
        createdByUserId: 'user-1',
        acceptedByUserId: null,
        expiresAt: '2026-07-14T00:00:00.000Z',
        acceptedAt: null,
        revokedAt: null,
        createdAt: '2026-06-30T00:00:00.000Z',
        updatedAt: '2026-06-30T00:00:00.000Z',
        inviteUrl: 'https://libroo.test/signup-invites/token-1'
      },
      token: 'token-1',
      inviteUrl: 'https://libroo.test/signup-invites/token-1'
    }
    serviceMocks.createSignupInvite.mockReturnValueOnce(Effect.succeed(createResult))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body }))).resolves.toBe(createResult)
    expect(serviceMocks.createSignupInvite).toHaveBeenCalledWith(testAdminUser, {
      email: 'grace@example.com',
      expiresInDays: 14
    })
  })

  it.each([
    ['invalid email', { email: 'not-an-email', expiresInDays: 14 }],
    ['invalid expiration', { email: 'grace@example.com', expiresInDays: 0 }],
    ['unsupported role field', { email: 'grace@example.com', role: 'admin' }]
  ])('rejects malformed invite bodies before calling the service: %s', async (_label, body) => {
    mockLoggedInAdmin()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body }))).rejects.toMatchObject({ statusCode: 400 })
    expect(serviceMocks.createSignupInvite).not.toHaveBeenCalled()
  })

  it('maps invalid signup invite requests to bad request responses', async () => {
    mockLoggedInAdmin()
    serviceMocks.createSignupInvite.mockReturnValueOnce(Effect.fail({ _tag: 'InvalidSignupInviteError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: {} }))).rejects.toMatchObject({ statusCode: 400 })
  })

  it('maps invite delivery failures to service unavailable responses', async () => {
    mockLoggedInAdmin()
    serviceMocks.createSignupInvite.mockReturnValueOnce(Effect.fail({ _tag: 'SignupInviteDeliveryError' }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ body: { email: 'grace@example.com' } }))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects unreadable request bodies before calling the service', async () => {
    mockLoggedInAdmin()
    const testGlobal = globalThis as typeof globalThis & {
      readValidatedBody: () => Promise<unknown>
    }
    testGlobal.readValidatedBody = () => Promise.reject(new Error('Unreadable body'))
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({ statusCode: 400 })
    expect(serviceMocks.createSignupInvite).not.toHaveBeenCalled()
  })
})
