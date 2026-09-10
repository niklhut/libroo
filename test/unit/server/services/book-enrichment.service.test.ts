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
import type {
  InvalidEnrichmentBatchError } from '../../../../server/services/book-enrichment.service'
import {
  BookEnrichmentServiceLive,
  enrichImportedBooks,
  getBookEnrichmentUpdates,
  runOwnedEnrichmentBatch
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
      getBatchProgress: vi.fn(() => Effect.succeed({ exists: true, pending: 1, nextAttemptAt: null })),
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

  it('passes the batch owner and worker bound through to claim selection', async () => {
    await runService({ batchId: 'batch-1', userId: 'owner-1', limit: 3 })

    expect(enrichmentRepository.claimJobs).toHaveBeenCalledWith(expect.objectContaining({
      batchId: 'batch-1',
      userId: 'owner-1',
      limit: 3
    }))
  })

  it('rejects a missing or foreign batch before claiming any work', async () => {
    vi.mocked(enrichmentRepository.getBatchProgress).mockReturnValueOnce(
      Effect.succeed({ exists: false, pending: 0, nextAttemptAt: null })
    )

    const effect = runOwnedEnrichmentBatch('other-user', 'batch-1', 3).pipe(
      Effect.provide(BookEnrichmentServiceLive),
      Effect.provide(Layer.succeed(BookEnrichmentRepository, enrichmentRepository)),
      Effect.provide(Layer.succeed(BookRepository, bookRepository)),
      Effect.provide(Layer.succeed(OpenLibraryRepository, openLibraryRepository))
    )

    await expect(Effect.runPromise(effect as Effect.Effect<unknown, InvalidEnrichmentBatchError, never>))
      .rejects.toThrow('Enrichment batch was not found')
    expect(enrichmentRepository.claimJobs).not.toHaveBeenCalled()
  })

  it('returns terminal batch progress without claiming new work', async () => {
    const terminal = { exists: true, pending: 0, nextAttemptAt: null }
    vi.mocked(enrichmentRepository.getBatchProgress)
      .mockReturnValueOnce(Effect.succeed(terminal))
      .mockReturnValueOnce(Effect.succeed(terminal))
    vi.mocked(enrichmentRepository.claimJobs).mockReturnValueOnce(Effect.succeed([]))

    const result = await runOwnedBatch('user-1', 'batch-1', 3)

    expect(result).toMatchObject({ claimed: 0, pending: 0, nextAttemptAt: null })
    expect(enrichmentRepository.claimJobs).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      batchId: 'batch-1',
      limit: 3
    }))
  })

  it('reports the earliest retry time while a batch still has pending work', async () => {
    const nextAttemptAt = new Date('2026-07-26T10:05:00.000Z')
    vi.mocked(enrichmentRepository.getBatchProgress)
      .mockReturnValueOnce(Effect.succeed({ exists: true, pending: 1, nextAttemptAt }))
      .mockReturnValueOnce(Effect.succeed({ exists: true, pending: 1, nextAttemptAt }))
    vi.mocked(enrichmentRepository.claimJobs).mockReturnValueOnce(Effect.succeed([]))

    const result = await runOwnedBatch('user-1', 'batch-1', 3)

    expect(result).toMatchObject({ pending: 1, nextAttemptAt })
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
      {
        userBookId: 'ub-1', bookId: 'book-1', author: 'Frank Herbert', authors: ['Frank Herbert'], coverPath: 'covers/9780441172719.webp',
        description: 'A desert planet', publishDate: '1965', publishers: 'Chilton', numberOfPages: 412,
        openLibraryKey: '/books/OL1M', workKey: '/works/OL1W', tags: 'Science Fiction', suggestedTags: 'Classic', status: 'completed'
      },
      {
        userBookId: 'ub-2', bookId: 'book-2', author: 'Frank Herbert', authors: ['Frank Herbert'], coverPath: null,
        description: null, publishDate: null, publishers: null, numberOfPages: null,
        openLibraryKey: null, workKey: null, tags: null, suggestedTags: null, status: 'retrying'
      }
    ]))
    const effect = getBookEnrichmentUpdates('user-1', ['ub-1', 'ub-2']).pipe(
      Effect.provide(BookEnrichmentServiceLive),
      Effect.provide(Layer.succeed(BookEnrichmentRepository, enrichmentRepository)),
      Effect.provide(Layer.succeed(BookRepository, bookRepository)),
      Effect.provide(Layer.succeed(OpenLibraryRepository, openLibraryRepository))
    )

    await expect(Effect.runPromise(effect as Effect.Effect<unknown, never, never>)).resolves.toEqual([
      {
        userBookId: 'ub-1', bookId: 'book-1', author: 'Frank Herbert', authors: ['Frank Herbert'], coverPath: 'covers/9780441172719.webp',
        isbn: undefined, coverUrl: '/api/blob/covers/9780441172719.webp', subjects: [],
        description: 'A desert planet', publishDate: '1965', publishers: ['Chilton'], numberOfPages: 412,
        openLibraryKey: '/books/OL1M', workKey: '/works/OL1W', tags: ['Science Fiction'], suggestedTags: ['Classic'], status: null
      },
      {
        userBookId: 'ub-2', bookId: 'book-2', author: 'Frank Herbert', authors: ['Frank Herbert'], coverPath: null,
        isbn: undefined, coverUrl: null, subjects: [], description: null, publishDate: undefined, publishers: null, numberOfPages: undefined,
        openLibraryKey: null, workKey: null, tags: [], suggestedTags: [], status: 'retrying'
      }
    ])
  })

  function runService(options: { batchId?: string, userId?: string, limit?: number } = { batchId: 'batch-1' }) {
    const effect = enrichImportedBooks(options).pipe(
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

  function runOwnedBatch(userId: string, batchId: string, limit?: number) {
    const effect = runOwnedEnrichmentBatch(userId, batchId, limit).pipe(
      Effect.provide(BookEnrichmentServiceLive),
      Effect.provide(Layer.succeed(BookEnrichmentRepository, enrichmentRepository)),
      Effect.provide(Layer.succeed(BookRepository, bookRepository)),
      Effect.provide(Layer.succeed(OpenLibraryRepository, openLibraryRepository))
    )
    return Effect.runPromise(effect as Effect.Effect<unknown, never, never>)
  }
})
