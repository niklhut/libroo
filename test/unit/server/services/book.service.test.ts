import { Effect, Either, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MANUAL_COVER_MAX_BASE64_LENGTH,
  MANUAL_COVER_MAX_DATA_URL_PREFIX_LENGTH,
  manualBookCreateSchema
} from '../../../../shared/utils/schemas'
import { BookRepository, type BookRepositoryInterface } from '../../../../server/repositories/book.repository'
import { LocationRepository, type LocationRepositoryInterface } from '../../../../server/repositories/location.repository'
import { BookServiceLive, createManualBook, decodeCoverImage, InvalidManualCoverError } from '../../../../server/services/book.service'
import { putCoverImage, StorageService, type StorageServiceInterface } from '../../../../server/services/storage.service'

Object.assign(globalThis, { BookRepository, LocationRepository, putCoverImage })

describe('manual cover validation', () => {
  const pngFixture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
  let bookRepository: Pick<BookRepositoryInterface, 'createManualBook'>
  let storageService: Pick<StorageServiceInterface, 'putCoverImage'>

  beforeEach(() => {
    bookRepository = {
      createManualBook: vi.fn(() => Effect.succeed({
        id: 'user-book-1',
        bookId: 'book-1',
        libraryState: 'owned',
        book: { id: 'book-1', title: 'Manual Book', author: 'Ada Lovelace', authors: [], isbn: null, coverPath: null, openLibraryKey: null, createdAt: new Date(), source: 'manual', createdByUserId: 'user-1' },
        location: null,
        lastKnownLocation: null,
        tags: [],
        addedAt: new Date(),
        activeLoan: null
      }))
    }
    storageService = {
      putCoverImage: vi.fn(() => Effect.succeed({ pathname: 'covers/manual/user-1/cover.webp', uploadedAt: new Date() }))
    }
  })

  it.each([
    ['an oversized encoded payload', 'A'.repeat(MANUAL_COVER_MAX_BASE64_LENGTH + 1)],
    ['a payload with an oversized data URL header', `data:${'x'.repeat(MANUAL_COVER_MAX_DATA_URL_PREFIX_LENGTH)};base64,iVBORw0KGgoA`],
    ['a payload that decodes over the byte limit', Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')],
    ['an empty payload', '   '],
    ['a non-canonical base64 payload', '/9j/4AB='],
    ['a non-image payload', Buffer.from('not an image').toString('base64')]
  ])('rejects %s as InvalidManualCoverError', async (_label, data) => {
    const result = await Effect.runPromise(Effect.either(decodeCoverImage(data)))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidManualCoverError)
  })

  it('accepts real image magic bytes and passes them to storage', async () => {
    const input = manualBookCreateSchema.parse({
      title: 'Manual Book',
      authors: ['Ada Lovelace'],
      coverImage: { data: `data:image/png;base64,${pngFixture.toString('base64')}`, contentType: 'image/png', size: 1 }
    })

    await Effect.runPromise(provide(createManualBook('user-1', input)))

    expect(storageService.putCoverImage).toHaveBeenCalledWith(
      expect.stringMatching(/^covers\/manual\/user-1\/.+\.webp$/),
      pngFixture
    )
  })

  it('rejects oversized data even when the client declares a tiny size', async () => {
    const input = {
      ...manualBookCreateSchema.parse({
        title: 'Manual Book',
        authors: ['Ada Lovelace']
      }),
      // This bypasses the route schema to exercise the service backstop directly.
      // The client-declared size must never affect the service's encoded-length gate.
      coverImage: { data: 'A'.repeat(MANUAL_COVER_MAX_BASE64_LENGTH + 1), contentType: 'image/png', size: 1 }
    }

    const result = await Effect.runPromise(Effect.either(provide(createManualBook('user-1', input))))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(InvalidManualCoverError)
    expect(storageService.putCoverImage).not.toHaveBeenCalled()
  })

  function provide<A, E>(effect: Effect.Effect<A, E, BookRepository | StorageService>) {
    return effect.pipe(
      Effect.provide(BookServiceLive),
      Effect.provide(Layer.succeed(BookRepository, bookRepository as BookRepositoryInterface)),
      Effect.provide(Layer.succeed(LocationRepository, {} as LocationRepositoryInterface)),
      Effect.provide(Layer.succeed(StorageService, storageService as StorageServiceInterface))
    )
  }
})
