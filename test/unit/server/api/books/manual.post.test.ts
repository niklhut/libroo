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
import { MANUAL_COVER_MAX_BYTES } from '../../../../../shared/utils/schemas'

const route = routePath('books/manual.post')

describe('server/api/books/manual.post', () => {
  beforeEach(setupApiRouteTest)
  afterEach(cleanupApiRouteTest)

  itRequiresAuth(route, {
    body: {
      title: 'Manual Book',
      authors: ['Ada Lovelace']
    }
  })

  it('creates a manual book', async () => {
    mockLoggedInUser()
    const book = { id: 'ub-1', title: 'Manual Book' }
    serviceMocks.createManualBook.mockReturnValueOnce(Effect.succeed(book))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      body: {
        title: ' Manual   Book ',
        authors: [' Ada Lovelace ', 'Ada Lovelace'],
        isbn: '',
        tags: [' math '],
        rating: 5,
        note: ' first edition ',
        readingStatus: 'read'
      }
    }))).resolves.toBe(book)

    expect(serviceMocks.createManualBook).toHaveBeenCalledWith('user-1', {
      title: 'Manual Book',
      authors: ['Ada Lovelace'],
      isbn: null,
      coverImage: null,
      publishDate: null,
      publisher: null,
      numberOfPages: null,
      tags: ['math'],
      rating: 5,
      note: 'first edition',
      readingStatus: 'read',
      currentPage: null,
      progressPercent: null
    })
  })

  it('normalizes optional ISBNs', async () => {
    mockLoggedInUser()
    const book = { id: 'ub-1', title: 'Manual Book' }
    serviceMocks.createManualBook.mockReturnValueOnce(Effect.succeed(book))
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      body: {
        title: 'Manual Book',
        authors: ['Ada Lovelace'],
        isbn: '978-0-306-40615-7'
      }
    }))).resolves.toBe(book)

    expect(serviceMocks.createManualBook).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ isbn: '9780306406157' })
    )
  })

  it('rejects cover images that are too large', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      body: {
        title: 'Manual Book',
        authors: ['Ada Lovelace'],
        coverImage: {
          data: 'data:image/png;base64,aGVsbG8=',
          contentType: 'image/png',
          size: MANUAL_COVER_MAX_BYTES + 1
        }
      }
    }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
  })

  it('rejects invalid manual payloads', async () => {
    mockLoggedInUser()
    const handler = await importRoute(route)

    await expect(handler(makeEvent({
      body: {
        title: '',
        authors: []
      }
    }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Validation Error'
    })
  })
})
