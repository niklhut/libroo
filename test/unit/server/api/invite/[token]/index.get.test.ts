import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cleanupApiRouteTest,
  importRoute,
  makeEvent,
  routePath,
  serviceMocks,
  setupApiRouteTest
} from '../../_helpers/api-route'

const route = routePath('invite/[token]/index.get')

describe('server/api/invite/[token]/index.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  it('returns only public invite preview fields', async () => {
    const preview = {
      title: 'Example',
      author: 'Author',
      coverPath: 'covers/example.webp',
      ownerName: 'Ada',
      dueAt: '2026-06-01T00:00:00.000Z',
      canAccept: true,
      isOwnInvite: false,
      status: 'available' as const
    }
    serviceMocks.getOptionalCurrentUserId.mockReturnValueOnce(Effect.succeed(null))
    serviceMocks.getInvitePreview.mockReturnValueOnce(Effect.succeed(preview))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { token: 'token-1' } }))).resolves.toEqual(preview)
    expect(serviceMocks.getOptionalCurrentUserId).toHaveBeenCalled()
    expect(serviceMocks.getInvitePreview).toHaveBeenCalledWith('token-1', null)
  })

  it('passes the optional viewer user id to invite previews', async () => {
    const preview = {
      title: 'Example',
      author: 'Author',
      coverPath: null,
      ownerName: 'Ada',
      dueAt: null,
      canAccept: false,
      isOwnInvite: true,
      status: 'own-invite' as const
    }
    serviceMocks.getOptionalCurrentUserId.mockReturnValueOnce(Effect.succeed('user-1'))
    serviceMocks.getInvitePreview.mockReturnValueOnce(Effect.succeed(preview))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { token: 'token-1' } }))).resolves.toEqual(preview)
    expect(serviceMocks.getInvitePreview).toHaveBeenCalledWith('token-1', 'user-1')
  })

  it('rejects missing tokens', async () => {
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invitation token is required'
    })
  })
})
