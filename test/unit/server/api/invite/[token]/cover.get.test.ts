import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InvalidInviteError } from '../../../../../../server/repositories/lending.repository'
import {
  cleanupApiRouteTest,
  importRoute,
  makeEvent,
  routePath,
  serviceMocks,
  setupApiRouteTest
} from '../../_helpers/api-route'

const route = routePath('invite/[token]/cover.get')

describe('server/api/invite/[token]/cover.get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  it('serves the cover resolved from the invite token preview', async () => {
    const blob = new Blob(['cover'], { type: 'image/webp' })
    serviceMocks.getInvitePreview.mockReturnValueOnce(Effect.succeed({
      title: 'Example',
      author: 'Author',
      coverPath: 'covers/manual/owner-1/book.webp',
      ownerName: 'Ada',
      dueAt: null,
      canAccept: true,
      isOwnInvite: false,
      status: 'available' as const
    }))
    serviceMocks.getBlob.mockReturnValueOnce(Effect.succeed(blob))
    const handler = await importRoute(route)
    const event = makeEvent({ params: { token: 'token-1' } })

    await expect(handler(event)).resolves.toBe(blob)
    expect(serviceMocks.getInvitePreview).toHaveBeenCalledWith('token-1')
    expect(serviceMocks.getBlob).toHaveBeenCalledWith('covers/manual/owner-1/book.webp')
    expect(serviceMocks.getAuthorizedCover).not.toHaveBeenCalled()
    expect(event.responseHeaders).toEqual({
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=3600'
    })
  })

  it('rejects missing invite tokens', async () => {
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      message: 'Invitation token is required'
    })
    expect(serviceMocks.getInvitePreview).not.toHaveBeenCalled()
    expect(serviceMocks.getBlob).not.toHaveBeenCalled()
  })

  it('returns not found when the invite has no cover snapshot', async () => {
    serviceMocks.getInvitePreview.mockReturnValueOnce(Effect.succeed({
      title: 'Example',
      author: 'Author',
      coverPath: null,
      ownerName: 'Ada',
      dueAt: null,
      canAccept: true,
      isOwnInvite: false,
      status: 'available' as const
    }))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { token: 'token-1' } }))).rejects.toMatchObject({
      statusCode: 404,
      message: 'Cover not found'
    })
    expect(serviceMocks.getBlob).not.toHaveBeenCalled()
  })

  it('returns not found when the token-scoped blob is missing', async () => {
    serviceMocks.getInvitePreview.mockReturnValueOnce(Effect.succeed({
      title: 'Example',
      author: 'Author',
      coverPath: 'covers/manual/owner-1/missing.webp',
      ownerName: 'Ada',
      dueAt: null,
      canAccept: true,
      isOwnInvite: false,
      status: 'available' as const
    }))
    serviceMocks.getBlob.mockReturnValueOnce(Effect.succeed(null))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { token: 'token-1' } }))).rejects.toMatchObject({
      statusCode: 404,
      message: 'Cover not found'
    })
  })

  it('maps invalid invite tokens through the public invite guard', async () => {
    serviceMocks.getInvitePreview.mockReturnValueOnce(Effect.fail(new InvalidInviteError({ message: 'This invitation is no longer available.' })))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { token: 'expired-token' } }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'This invitation is no longer available.'
    })
    expect(serviceMocks.getBlob).not.toHaveBeenCalled()
  })
})
