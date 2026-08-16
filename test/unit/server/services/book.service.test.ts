import { Effect, Either, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MANUAL_COVER_MAX_BASE64_LENGTH,
  MANUAL_COVER_MAX_DATA_URL_PREFIX_LENGTH,
  manualBookCreateSchema
} from '../../../../shared/utils/schemas'
import { BookRepository, DatabaseError, type BookRepositoryInterface } from '../../../../server/repositories/book.repository'
import { BookEnrichmentRepository, type BookEnrichmentRepositoryInterface } from '../../../../server/repositories/book-enrichment.repository'
import { CanonicalBookEnrichmentRepository, type CanonicalBookEnrichmentRepository as CanonicalBookEnrichmentRepositoryService } from '../../../../server/repositories/canonical-book-enrichment.repository'
import { LocationRepository, type LocationRepositoryInterface } from '../../../../server/repositories/location.repository'
import { OpenLibraryApiError, OpenLibraryRepository, type OpenLibraryRepositoryInterface } from '../../../../server/repositories/openLibrary.repository'
import type { BookService } from '../../../../server/services/book.service'
import { BookServiceLive, bulkLookupBooks, createManualBook, decodeCoverImage, getBookDetails, getUserLibrary, InvalidManualCoverError } from '../../../../server/services/book.service'
import { putCoverImage, StorageService, type StorageServiceInterface } from '../../../../server/services/storage.service'

Object.assign(globalThis, { BookRepository, OpenLibraryRepository, LocationRepository, putCoverImage })

const canonicalEnrichmentRepository = {
  get: () => Effect.succeed(null)
} as unknown as CanonicalBookEnrichmentRepositoryService['Service']

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
      Effect.provide(Layer.succeed(BookEnrichmentRepository, {} as BookEnrichmentRepositoryInterface)),
      Effect.provide(Layer.succeed(CanonicalBookEnrichmentRepository, canonicalEnrichmentRepository)),
      Effect.provide(Layer.succeed(OpenLibraryRepository, {} as OpenLibraryRepositoryInterface)),
      Effect.provide(Layer.succeed(LocationRepository, {} as LocationRepositoryInterface)),
      Effect.provide(Layer.succeed(StorageService, storageService as StorageServiceInterface))
    )
  }
})

describe('optional enrichment status decoration', () => {
  const userBook = {
    id: 'user-book-1',
    bookId: 'book-1',
    libraryState: 'owned' as const,
    book: {
      title: 'Dune',
      author: 'Frank Herbert',
      authors: [{ id: 'author-1', name: 'Frank Herbert' }],
      isbn: '9780441172719',
      coverPath: null
    },
    location: null,
    lastKnownLocation: null,
    tags: [],
    addedAt: new Date('2026-07-27T10:00:00.000Z'),
    activeLoan: null
  }
  const details = {
    id: userBook.id,
    bookId: userBook.bookId,
    libraryState: userBook.libraryState,
    title: userBook.book.title,
    author: userBook.book.author,
    authors: userBook.book.authors,
    isbn: userBook.book.isbn,
    coverPath: null,
    description: null,
    rating: null,
    note: null,
    location: null,
    lastKnownLocation: null,
    readingProgress: {
      status: 'unread' as const,
      currentPage: null,
      progressPercent: null,
      startedAt: null,
      finishedAt: null
    },
    userTags: [],
    suggestedTags: [],
    publishDate: null,
    publishers: null,
    numberOfPages: null,
    openLibraryKey: null,
    workKey: null,
    addedAt: userBook.addedAt,
    activeLoan: null
  }

  it('returns library and detail payloads when enrichment status lookup fails', async () => {
    const bookRepository = {
      getLibrary: vi.fn(() => Effect.succeed({
        items: [userBook],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 }
      })),
      getUserBookWithDetails: vi.fn(() => Effect.succeed(details))
    } as unknown as BookRepositoryInterface
    const enrichmentRepository = {
      getStatusesForUserBooks: vi.fn(() => Effect.fail(new DatabaseError({
        message: 'status table unavailable',
        operation: 'getStatusesForUserBooks'
      })))
    } as unknown as BookEnrichmentRepositoryInterface

    const provideService = <A, E>(effect: Effect.Effect<A, E, BookService>) =>
      effect.pipe(
        Effect.provide(BookServiceLive),
        Effect.provide(Layer.succeed(BookRepository, bookRepository)),
        Effect.provide(Layer.succeed(BookEnrichmentRepository, enrichmentRepository)),
        Effect.provide(Layer.succeed(CanonicalBookEnrichmentRepository, canonicalEnrichmentRepository)),
        Effect.provide(Layer.succeed(OpenLibraryRepository, {} as OpenLibraryRepositoryInterface)),
        Effect.provide(Layer.succeed(LocationRepository, {} as LocationRepositoryInterface))
      )

    const library = await Effect.runPromise(provideService(
      getUserLibrary('user-1', { page: 1, pageSize: 20 })
    ))
    const bookDetails = await Effect.runPromise(provideService(
      getBookDetails('user-book-1', 'user-1')
    ))

    expect(library.items[0]?.enrichmentStatus).toBeNull()
    expect(bookDetails.enrichmentStatus).toBeNull()
    expect(enrichmentRepository.getStatusesForUserBooks).toHaveBeenCalledTimes(2)
  })
})

describe('bulk ISBN lookup', () => {
  it('validates and deduplicates inputs while combining local and remote results', async () => {
    const localBook = {
      id: 'local-book', isbn: '9780306406157', title: 'Local', author: 'Local Author',
      authors: [{ id: 'author-1', name: 'Local Author' }], coverPath: null, openLibraryKey: '/books/OL1M',
      createdAt: new Date(), source: 'open_library' as const, createdByUserId: null
    }
    const remoteBook = {
      id: 'remote-book', isbn: '9780141439518', title: 'Remote', author: 'Remote Author',
      authors: [{ id: 'author-2', name: 'Remote Author' }], coverPath: 'covers/9780141439518.webp', openLibraryKey: '/books/OL2M',
      createdAt: new Date(), source: 'open_library' as const, createdByUserId: null
    }
    const bookRepository = {
      findByIsbns: vi.fn(() => Effect.succeed(new Map([[localBook.isbn, localBook]]))),
      findUserLibraryByIsbns: vi.fn(() => Effect.succeed(new Map([[localBook.isbn, { userBookId: 'user-book-1', libraryState: 'owned' as const }]]))),
      getSystemTagsByBookId: vi.fn(() => Effect.succeed([])),
      ensureOpenLibraryBook: vi.fn(() => Effect.succeed(remoteBook))
    } as unknown as BookRepositoryInterface
    const openLibraryRepository = {
      lookupByISBNs: vi.fn(() => Effect.succeed(new Map([[remoteBook.isbn, {
        title: remoteBook.title,
        authors: ['Remote Author'],
        isbn: remoteBook.isbn,
        openLibraryKey: remoteBook.openLibraryKey,
        workKey: null,
        coverUrl: null
      }]])))
    } as unknown as OpenLibraryRepositoryInterface

    const result = await Effect.runPromise(bulkLookupBooks('user-1', [
      '978-0-306-40615-7',
      'invalid',
      '9780306406157',
      '9780141439518'
    ]).pipe(
      Effect.provide(BookServiceLive),
      Effect.provide(Layer.succeed(BookRepository, bookRepository)),
      Effect.provide(Layer.succeed(BookEnrichmentRepository, {} as BookEnrichmentRepositoryInterface)),
      Effect.provide(Layer.succeed(CanonicalBookEnrichmentRepository, canonicalEnrichmentRepository)),
      Effect.provide(Layer.succeed(OpenLibraryRepository, openLibraryRepository)),
      Effect.provide(Layer.succeed(LocationRepository, {} as LocationRepositoryInterface))
    ))

    expect(result.items).toHaveLength(4)
    expect(result.items[0]).toMatchObject({ status: 'ok', normalizedIsbn: localBook.isbn, result: { existsLocally: true } })
    expect(result.items[1]).toMatchObject({ status: 'invalid', normalizedIsbn: null })
    expect(result.items[2]).toMatchObject({ status: 'ok', normalizedIsbn: localBook.isbn, duplicateOf: 0 })
    expect(result.items[3]).toMatchObject({ status: 'ok', normalizedIsbn: remoteBook.isbn, result: { coverUrl: '/api/blob/covers/9780141439518.webp' } })
    expect(openLibraryRepository.lookupByISBNs).toHaveBeenCalledWith([remoteBook.isbn])
    expect(bookRepository.ensureOpenLibraryBook).toHaveBeenCalledOnce()
  })

  it('returns an upstream failure for each unresolved ISBN without failing the request', async () => {
    const bookRepository = {
      findByIsbns: () => Effect.succeed(new Map()),
      findUserLibraryByIsbns: () => Effect.succeed(new Map())
    } as unknown as BookRepositoryInterface
    const openLibraryRepository = {
      lookupByISBNs: () => Effect.fail(new OpenLibraryApiError({ message: 'unavailable' }))
    } as unknown as OpenLibraryRepositoryInterface

    const result = await Effect.runPromise(bulkLookupBooks('user-1', [
      '9780306406157',
      '9780141439518'
    ]).pipe(
      Effect.provide(BookServiceLive),
      Effect.provide(Layer.succeed(BookRepository, bookRepository)),
      Effect.provide(Layer.succeed(BookEnrichmentRepository, {} as BookEnrichmentRepositoryInterface)),
      Effect.provide(Layer.succeed(CanonicalBookEnrichmentRepository, canonicalEnrichmentRepository)),
      Effect.provide(Layer.succeed(OpenLibraryRepository, openLibraryRepository)),
      Effect.provide(Layer.succeed(LocationRepository, {} as LocationRepositoryInterface))
    ))

    expect(result.items).toEqual([
      expect.objectContaining({ normalizedIsbn: '9780306406157', status: 'error', errorCode: 'upstream_failure' }),
      expect.objectContaining({ normalizedIsbn: '9780141439518', status: 'error', errorCode: 'upstream_failure' })
    ])
  })

  it('serializes remote persistence to avoid SQLite writer contention', async () => {
    const isbns = ['9780306406157', '9780141439518']
    let active = 0
    let maxActive = 0
    const ensureOpenLibraryBook = vi.fn((isbn: string) => Effect.promise(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 5))
      active -= 1
      return {
        id: `book-${isbn}`, isbn, title: isbn, author: 'Author', authors: [], coverPath: null,
        openLibraryKey: '/books/OL1M', createdAt: new Date(), source: 'open_library' as const,
        createdByUserId: null
      }
    }))
    const bookRepository = {
      findByIsbns: () => Effect.succeed(new Map()),
      findUserLibraryByIsbns: () => Effect.succeed(new Map()),
      ensureOpenLibraryBook,
      getSystemTagsByBookId: () => Effect.succeed([])
    } as unknown as BookRepositoryInterface
    const openLibraryRepository = {
      lookupByISBNs: () => Effect.succeed(new Map(isbns.map(isbn => [isbn, {
        title: isbn, authors: ['Author'], isbn, openLibraryKey: '/books/OL1M', workKey: null, coverUrl: null
      }])))
    } as unknown as OpenLibraryRepositoryInterface

    const result = await Effect.runPromise(bulkLookupBooks('user-1', isbns).pipe(
      Effect.provide(BookServiceLive),
      Effect.provide(Layer.succeed(BookRepository, bookRepository)),
      Effect.provide(Layer.succeed(BookEnrichmentRepository, {} as BookEnrichmentRepositoryInterface)),
      Effect.provide(Layer.succeed(CanonicalBookEnrichmentRepository, canonicalEnrichmentRepository)),
      Effect.provide(Layer.succeed(OpenLibraryRepository, openLibraryRepository)),
      Effect.provide(Layer.succeed(LocationRepository, {} as LocationRepositoryInterface))
    ))

    expect(result.items.every(item => item.status === 'ok')).toBe(true)
    expect(ensureOpenLibraryBook).toHaveBeenCalledTimes(2)
    expect(maxActive).toBe(1)
  })

  it('prepares remote covers once and passes their paths into serial persistence', async () => {
    const isbns = ['9780306406157', '9780141439518']
    const remoteData = new Map(isbns.map(isbn => [isbn, {
      title: isbn,
      authors: ['Author'],
      isbn,
      openLibraryKey: '/books/OL1M',
      workKey: null,
      coverUrl: `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`
    }]))
    const ensureOpenLibraryBook = vi.fn((isbn: string, _data: unknown, coverPath: string | null) => Effect.succeed({
      id: `book-${isbn}`,
      isbn,
      title: isbn,
      author: 'Author',
      authors: [],
      coverPath,
      openLibraryKey: '/books/OL1M',
      createdAt: new Date(),
      source: 'open_library' as const,
      createdByUserId: null
    }))
    const bookRepository = {
      findByIsbns: () => Effect.succeed(new Map()),
      findUserLibraryByIsbns: () => Effect.succeed(new Map()),
      findStoredOpenLibraryCover: vi.fn(() => Effect.succeed(null)),
      ensureOpenLibraryBook,
      getSystemTagsByBookId: () => Effect.succeed([])
    } as unknown as BookRepositoryInterface
    const downloadCovers = vi.fn(() => Effect.succeed(new Map(isbns.map(isbn => [isbn, `covers/${isbn}.webp`]))))
    const openLibraryRepository = {
      lookupByISBNs: () => Effect.succeed(remoteData),
      downloadCovers
    } as unknown as OpenLibraryRepositoryInterface

    const result = await Effect.runPromise(bulkLookupBooks('user-1', isbns).pipe(
      Effect.provide(BookServiceLive),
      Effect.provide(Layer.succeed(BookRepository, bookRepository)),
      Effect.provide(Layer.succeed(BookEnrichmentRepository, {} as BookEnrichmentRepositoryInterface)),
      Effect.provide(Layer.succeed(CanonicalBookEnrichmentRepository, canonicalEnrichmentRepository)),
      Effect.provide(Layer.succeed(OpenLibraryRepository, openLibraryRepository)),
      Effect.provide(Layer.succeed(LocationRepository, {} as LocationRepositoryInterface))
    ))

    expect(result.items.every(item => item.status === 'ok')).toBe(true)
    expect(downloadCovers).toHaveBeenCalledWith(isbns, 'L')
    expect(ensureOpenLibraryBook).toHaveBeenNthCalledWith(1, isbns[0], remoteData.get(isbns[0]), `covers/${isbns[0]}.webp`)
    expect(ensureOpenLibraryBook).toHaveBeenNthCalledWith(2, isbns[1], remoteData.get(isbns[1]), `covers/${isbns[1]}.webp`)
  })
})
