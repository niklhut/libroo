import { Effect } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CoverAccessDeniedError } from '../../../../../server/services/coverAccess.service'
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

const route = routePath('blob/[...pathname].get')

describe('server/api/blob/[...pathname].get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { pathname: 'covers/book.webp' } })

  it('serves an owner cover with private headers', async () => {
    mockLoggedInUser()
    const blob = new Blob(['cover'], { type: 'image/webp' })
    serviceMocks.getAuthorizedCover.mockReturnValueOnce(Effect.succeed(blob))
    const handler = await importRoute(route)
    const event = makeEvent({ params: { pathname: 'covers/manual/user-1/book.webp' } })

    await expect(handler(event)).resolves.toBe(blob)
    expect(serviceMocks.getAuthorizedCover).toHaveBeenCalledWith('covers/manual/user-1/book.webp', expect.objectContaining({ id: 'user-1' }))
    expect(event.responseHeaders).toEqual({
      'Content-Type': 'image/webp',
      'Cache-Control': 'private, max-age=3600'
    })
  })

  it('serves a borrower cover with private headers', async () => {
    mockLoggedInUser({ id: 'borrower-1', name: 'Bea', email: 'bea@example.com' })
    const blob = new Blob(['borrowed'], { type: 'image/png' })
    serviceMocks.getAuthorizedCover.mockReturnValueOnce(Effect.succeed(blob))
    const handler = await importRoute(route)
    const event = makeEvent({ params: { pathname: 'covers/manual/owner-1/book.png' } })

    await expect(handler(event)).resolves.toBe(blob)
    expect(serviceMocks.getAuthorizedCover).toHaveBeenCalledWith('covers/manual/owner-1/book.png', expect.objectContaining({ id: 'borrower-1' }))
    expect(event.responseHeaders).toEqual({
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=3600'
    })
  })

  it('rejects missing pathnames', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent())).rejects.toMatchObject({
      statusCode: 400,
      message: 'Pathname is required'
    })
    expect(serviceMocks.getAuthorizedCover).not.toHaveBeenCalled()
  })

  it('returns non-disclosing not found for unrelated users', async () => {
    mockLoggedInUser()
    serviceMocks.getAuthorizedCover.mockReturnValueOnce(Effect.fail(new CoverAccessDeniedError({ pathname: 'covers/manual/other/book.webp' })))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { pathname: 'covers/manual/other/book.webp' } }))).rejects.toMatchObject({
      statusCode: 404,
      message: 'Cover not found'
    })
  })

  it('returns non-disclosing not found for invalid cover paths', async () => {
    mockLoggedInUser()
    serviceMocks.getAuthorizedCover.mockReturnValueOnce(Effect.fail(new CoverAccessDeniedError({ pathname: 'avatars/user-1.webp' })))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { pathname: 'avatars/user-1.webp' } }))).rejects.toMatchObject({
      statusCode: 404,
      message: 'Cover not found'
    })
  })
})
