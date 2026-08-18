import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BookEnrichmentRepository,
  type BookEnrichmentRepositoryInterface,
  type ClaimedBookEnrichmentJob
} from '../../../../server/repositories/book-enrichment.repository'
import { BookRepository, type BookRepositoryInterface } from '../../../../server/repositories/book.repository'
import {
  OpenLibraryApiError,
  OpenLibraryRepository,
  type OpenLibraryRepositoryInterface
} from '../../../../server/repositories/openLibrary.repository'
import {
  BookEnrichmentServiceLive,
  enrichImportedBooks,
  getBookEnrichmentUpdates
} from '../../../../server/services/book-enrichment.service'

const job: ClaimedBookEnrichmentJob = {
  id: 'job-1',
  batchId: 'batch-1',
  userId: 'user-1',
  bookId: 'book-1',
  isbn: '9780441172719',
  attempts: 1,
  maxAttempts: 5,
  claimToken: 'claim-1'
}

describe('BookEnrichmentService', () => {
  let enrichmentRepository: BookEnrichmentRepositoryInterface
  let bookRepository: BookRepositoryInterface
  let openLibraryRepository: OpenLibraryRepositoryInterface

  beforeEach(() => {
    enrichmentRepository = {
      cancelIneligibleJobs: vi.fn(() => Effect.succeed(0)),
      claimJobs: vi.fn(() => Effect.succeed([job])),
      acquireIsbnLocks: vi.fn(() => Effect.succeed(new Set([job.isbn]))),
      releaseIsbnLocks: vi.fn(() => Effect.void),
      applyMetadata: vi.fn(() => Effect.succeed(true)),
      markCompleted: vi.fn(() => Effect.succeed(true)),
      scheduleRetry: vi.fn(() => Effect.succeed(true)),
      markFailed: vi.fn(() => Effect.succeed(true)),
      cancelClaim: vi.fn(() => Effect.succeed(true)),
      deferClaim: vi.fn(() => Effect.succeed(true)),
      getStatusesForUserBooks: vi.fn(() => Effect.succeed(new Map())),
      getUpdatesForUserBooks: vi.fn(() => Effect.succeed([])),
      isCoverReferenced: vi.fn(() => Effect.succeed(false))
    } as BookEnrichmentRepositoryInterface
    bookRepository = {
      findStoredOpenLibraryCover: vi.fn(() => Effect.succeed(null)),
      addSystemTagsToBook: vi.fn(() => Effect.succeed(undefined))
    } as unknown as BookRepositoryInterface
    openLibraryRepository = {
      lookupByISBNs: vi.fn(() => Effect.succeed(new Map([[job.isbn, {
        title: 'Provider title must not replace the import',
        authors: ['Provider Author'],
        isbn: job.isbn,
        openLibraryKey: '/books/OL1M',
        workKey: '/works/OL1W',
        coverUrl: null,
        description: 'Provider description',
        subjects: ['Science Fiction']
      }]]))),
      downloadCovers: vi.fn(() => Effect.succeed(new Map()))
    } as unknown as OpenLibraryRepositoryInterface
  })

  it('adds provider fields and tags without passing title or authors to persistence', async () => {
    const result = await runService()

    expect(result).toMatchObject({ claimed: 1, noCover: 1, enriched: 0 })
    expect(enrichmentRepository.applyMetadata).toHaveBeenCalledWith(
      job,
      expect.not.objectContaining({ title: expect.anything(), authors: expect.anything() })
    )
    expect(enrichmentRepository.applyMetadata).toHaveBeenCalledWith(job, expect.objectContaining({
      description: 'Provider description',
      openLibraryKey: '/books/OL1M',
      workKey: '/works/OL1W'
    }))
    expect(bookRepository.addSystemTagsToBook).toHaveBeenCalledWith('book-1', ['Science Fiction'])
    expect(enrichmentRepository.markCompleted).toHaveBeenCalledWith(
      'job-1',
      'claim-1',
      'no_cover',
      expect.any(String),
      expect.any(Date)
    )
    expect(enrichmentRepository.releaseIsbnLocks).toHaveBeenCalled()
  })

  it('retries transient provider failures and always releases the ISBN lock', async () => {
    vi.mocked(openLibraryRepository.lookupByISBNs).mockReturnValueOnce(
      Effect.fail(new OpenLibraryApiError({ message: 'temporary outage' }))
    )

    const result = await runService()

    expect(result).toMatchObject({ claimed: 1, retried: 1, failed: 0 })
    expect(enrichmentRepository.scheduleRetry).toHaveBeenCalledWith(
      'job-1',
      'claim-1',
      expect.any(Date),
      'temporary outage',
      expect.any(Date)
    )
    expect(enrichmentRepository.applyMetadata).not.toHaveBeenCalled()
    expect(enrichmentRepository.releaseIsbnLocks).toHaveBeenCalled()
  })

  it('cancels a stale claim and leaves the downloaded shared cover for cleanup checks', async () => {
    vi.mocked(openLibraryRepository.lookupByISBNs).mockReturnValueOnce(Effect.succeed(new Map([[job.isbn, {
      title: 'Provider title',
      authors: ['Provider Author'],
      isbn: job.isbn,
      openLibraryKey: '/books/OL1M',
      workKey: null,
      coverUrl: 'https://covers.example/cover.jpg'
    }]])))
    vi.mocked(openLibraryRepository.downloadCovers).mockReturnValueOnce(
      Effect.succeed(new Map([[job.isbn, 'covers/9780441172719.webp']]))
    )
    vi.mocked(enrichmentRepository.applyMetadata).mockReturnValueOnce(Effect.succeed(false))
    vi.mocked(enrichmentRepository.isCoverReferenced).mockReturnValueOnce(Effect.succeed(true))

    const result = await runService()

    expect(result).toMatchObject({ claimed: 1, cancelled: 1 })
    expect(enrichmentRepository.cancelClaim).toHaveBeenCalled()
    expect(enrichmentRepository.isCoverReferenced).toHaveBeenCalledWith('covers/9780441172719.webp')
  })

  it('maps internal job states to silent card updates', async () => {
    vi.mocked(enrichmentRepository.getUpdatesForUserBooks).mockReturnValueOnce(Effect.succeed([
      { userBookId: 'ub-1', author: 'Frank Herbert', coverPath: 'covers/9780441172719.webp', status: 'completed' },
      { userBookId: 'ub-2', author: 'Frank Herbert', coverPath: null, status: 'retrying' }
    ]))
    const effect = getBookEnrichmentUpdates('user-1', ['ub-1', 'ub-2']).pipe(
      Effect.provide(BookEnrichmentServiceLive),
      Effect.provide(Layer.succeed(BookEnrichmentRepository, enrichmentRepository)),
      Effect.provide(Layer.succeed(BookRepository, bookRepository)),
      Effect.provide(Layer.succeed(OpenLibraryRepository, openLibraryRepository))
    )

    await expect(Effect.runPromise(effect as Effect.Effect<unknown, never, never>)).resolves.toEqual([
      { userBookId: 'ub-1', author: 'Frank Herbert', coverPath: 'covers/9780441172719.webp', status: null },
      { userBookId: 'ub-2', author: 'Frank Herbert', coverPath: null, status: 'retrying' }
    ])
  })

  function runService() {
    const effect = enrichImportedBooks({ batchId: 'batch-1' }).pipe(
      Effect.provide(BookEnrichmentServiceLive),
      Effect.provide(Layer.succeed(BookEnrichmentRepository, enrichmentRepository)),
      Effect.provide(Layer.succeed(BookRepository, bookRepository)),
      Effect.provide(Layer.succeed(OpenLibraryRepository, openLibraryRepository))
    )
    return Effect.runPromise(effect as Effect.Effect<{
      claimed: number
      enriched: number
      noCover: number
      notFound: number
      retried: number
      failed: number
      cancelled: number
    }, never, never>)
  }
})
