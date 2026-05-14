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
} from '../_helpers/api-route'

const route = routePath('blob/[...pathname].get')

describe('server/api/blob/[...pathname].get', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, { params: { pathname: 'covers/book.webp' } })

  it('serves a private blob with headers', async () => {
    mockLoggedInUser()
    const blob = new Blob(['cover'], { type: 'image/webp' })
    serviceMocks.getBlob.mockReturnValueOnce(Effect.succeed(blob))
    const handler = await importRoute(route)
    const event = makeEvent({ params: { pathname: 'covers/book.webp' } })

    await expect(handler(event)).resolves.toBe(blob)
    expect(serviceMocks.getBlob).toHaveBeenCalledWith('covers/book.webp')
    expect(event.responseHeaders).toEqual({
      'Content-Type': 'image/webp',
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
  })

  it('returns not found when the blob does not exist', async () => {
    mockLoggedInUser()
    serviceMocks.getBlob.mockReturnValueOnce(Effect.succeed(null))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({ params: { pathname: 'missing.webp' } }))).rejects.toMatchObject({
      statusCode: 404,
      message: 'Blob not found'
    })
  })
})
