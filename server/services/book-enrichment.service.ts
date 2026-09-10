import { Context, Data, Effect, Layer } from 'effect'
import type * as HttpClient from '@effect/platform/HttpClient'
import { BookEnrichmentRepository, type BookEnrichmentUpdateRecord, type ClaimedBookEnrichmentJob } from '../repositories/book-enrichment.repository'
import { BookRepository, type DatabaseError } from '../repositories/book.repository'
import { OpenLibraryRepository } from '../repositories/openLibrary.repository'
import type { DbService } from './db.service'
import { deleteBlob, type StorageError, type StorageService } from './storage.service'
import { getBooksEnrichmentConfig } from '../utils/books-config'
import { toBookEnrichmentUiStatus } from '../../shared/utils/book-enrichment'
import type { LibraryBookEnrichmentUpdate } from '../../shared/types/book'

export interface EnrichImportedBooksResult {
  claimed: number
  enriched: number
  noCover: number
  notFound: number
  retried: number
  failed: number
  cancelled: number
}

export interface BookEnrichmentServiceInterface {
  runOwnedBatch: (userId: string, batchId: string, limit?: number) => Effect.Effect<EnrichImportedBooksResult & { pending: number, nextAttemptAt: Date | null, updates: LibraryBookEnrichmentUpdate[] }, DatabaseError | InvalidEnrichmentBatchError, DbService | StorageService | OpenLibraryRepository | HttpClient.HttpClient>
  enrichImportedBooks: (options?: {
    batchId?: string
    limit?: number
    userId?: string
  }) => Effect.Effect<
    EnrichImportedBooksResult,
    DatabaseError,
    DbService | StorageService | OpenLibraryRepository | HttpClient.HttpClient
  >
  getUpdatesForUserBooks: (
    userId: string,
    userBookIds: string[]
  ) => Effect.Effect<LibraryBookEnrichmentUpdate[], DatabaseError, DbService>
  cleanupSharedCoverIfUnreferenced: (
    pathname: string
  ) => Effect.Effect<boolean, DatabaseError | StorageError, DbService | StorageService>
}

export class InvalidEnrichmentBatchError extends Data.TaggedError('InvalidEnrichmentBatchError')<{
  message: string
}> {}

export class BookEnrichmentService extends Context.Tag('BookEnrichmentService')<
  BookEnrichmentService,
  BookEnrichmentServiceInterface
>() {}

function groupJobsByIsbn(jobs: ClaimedBookEnrichmentJob[]) {
  const grouped = new Map<string, ClaimedBookEnrichmentJob[]>()
  for (const job of jobs) {
    const entries = grouped.get(job.isbn) ?? []
    entries.push(job)
    grouped.set(job.isbn, entries)
  }
  return grouped
}

function retryAt(now: Date, attempts: number, baseSeconds: number) {
  const exponentialSeconds = Math.min(24 * 60 * 60, baseSeconds * 2 ** Math.max(0, attempts - 1))
  const jitter = 0.75 + Math.random() * 0.5
  return new Date(now.getTime() + Math.round(exponentialSeconds * jitter) * 1000)
}

function parseStringList(value: unknown) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean)
  }
}

function toEnrichmentUpdate(update: BookEnrichmentUpdateRecord): LibraryBookEnrichmentUpdate {
  return {
    userBookId: update.userBookId,
    bookId: update.bookId,
    author: update.author,
    authors: parseStringList(update.authors),
    isbn: update.isbn,
    coverUrl: update.coverPath ? `/api/blob/${update.coverPath}` : null,
    subjects: parseStringList(update.subjects),
    coverPath: update.coverPath,
    description: update.description,
    publishDate: update.publishDate ?? undefined,
    publishers: update.publishers ? update.publishers.split(', ').filter(Boolean) : null,
    numberOfPages: update.numberOfPages ?? undefined,
    openLibraryKey: update.openLibraryKey,
    workKey: update.workKey,
    tags: parseStringList(update.tags),
    suggestedTags: parseStringList(update.suggestedTags),
    status: toBookEnrichmentUiStatus(update.status ?? undefined)
  }
}

export const BookEnrichmentServiceLive = Layer.effect(
  BookEnrichmentService,
  Effect.gen(function* () {
    const enrichmentRepo = yield* BookEnrichmentRepository
    const bookRepo = yield* BookRepository
    const openLibraryRepo = yield* OpenLibraryRepository

    const cleanupSharedCoverIfUnreferenced = (pathname: string) =>
      Effect.gen(function* () {
        if (pathname.startsWith('covers/manual/')) return false
        const referenced = yield* enrichmentRepo.isCoverReferenced(pathname)
        if (referenced) return false
        yield* deleteBlob(pathname)
        return true
      })

    const enrichImportedBooksImpl = (options: {
      batchId?: string
      limit?: number
      userId?: string
      onClaimed?: (jobs: ClaimedBookEnrichmentJob[]) => Effect.Effect<void, DatabaseError, DbService>
    } = {}) => Effect.gen(function* () {
      const config = getBooksEnrichmentConfig()
      const now = new Date()
      yield* enrichmentRepo.cancelIneligibleJobs(now)
      const leaseExpiresAt = new Date(now.getTime() + config.leaseSeconds * 1000)
      const jobs = yield* enrichmentRepo.claimJobs({
        limit: Math.min(options.limit ?? config.batchSize, 20),
        leaseExpiresAt,
        now,
        batchId: options.batchId,
        userId: options.userId
      })
      if (options.onClaimed) yield* options.onClaimed(jobs)
      const result: EnrichImportedBooksResult = {
        claimed: jobs.length,
        enriched: 0,
        noCover: 0,
        notFound: 0,
        retried: 0,
        failed: 0,
        cancelled: 0
      }
      if (jobs.length === 0) return result

      const claimToken = jobs[0]!.claimToken
      const groupedJobs = groupJobsByIsbn(jobs)
      const isbns = [...groupedJobs.keys()]
      const lockedIsbns = yield* enrichmentRepo.acquireIsbnLocks(isbns, claimToken, leaseExpiresAt, now)
      const unlockedJobs = jobs.filter(job => !lockedIsbns.has(job.isbn))
      for (const job of unlockedJobs) {
        yield* enrichmentRepo.deferClaim(job.id, job.claimToken, new Date(now.getTime() + 15_000), now)
      }
      const acquiredIsbns = isbns.filter(isbn => lockedIsbns.has(isbn))
      if (acquiredIsbns.length === 0) return result

      const releaseLocks = enrichmentRepo.releaseIsbnLocks(acquiredIsbns, claimToken).pipe(
        Effect.catchAll(error => Effect.logWarning(`Failed to release enrichment ISBN locks: ${String(error)}`))
      )
      yield* Effect.gen(function* () {
        const lookupResult = yield* Effect.either(openLibraryRepo.lookupByISBNs(acquiredIsbns))
        if (lookupResult._tag === 'Left') {
          for (const isbn of acquiredIsbns) {
            for (const job of groupedJobs.get(isbn) ?? []) {
              if (job.attempts >= job.maxAttempts) {
                yield* enrichmentRepo.markFailed(job.id, job.claimToken, lookupResult.left.message, now)
                result.failed++
              } else {
                yield* enrichmentRepo.scheduleRetry(job.id, job.claimToken, retryAt(now, job.attempts, config.backoffSeconds), lookupResult.left.message, now)
                result.retried++
              }
            }
          }
          return
        }
        const metadataByIsbn = lookupResult.right
        const coverCandidates = acquiredIsbns.filter(isbn => Boolean(metadataByIsbn.get(isbn)?.coverUrl))
        const storedEntries = yield* Effect.forEach(coverCandidates, isbn => bookRepo.findStoredOpenLibraryCover(isbn).pipe(Effect.map(pathname => [isbn, pathname] as const)), { concurrency: config.concurrency })
        const coverPaths = new Map(storedEntries)
        const missingCovers = coverCandidates.filter(isbn => !coverPaths.get(isbn))
        const downloadedCovers = missingCovers.length > 0 ? yield* openLibraryRepo.downloadCovers(missingCovers, 'L') : new Map<string, string | null>()
        const freshlyDownloaded = new Set<string>()
        for (const [isbn, pathname] of downloadedCovers) {
          coverPaths.set(isbn, pathname)
          if (pathname) freshlyDownloaded.add(pathname)
        }

        for (const isbn of acquiredIsbns) {
          const data = metadataByIsbn.get(isbn)
          let appliedCount = 0
          for (const job of groupedJobs.get(isbn) ?? []) {
            if (!data) {
              yield* enrichmentRepo.markCompleted(job.id, job.claimToken, 'not_found', 'Open Library has no record for this ISBN', now)
              result.notFound++
              continue
            }
            const applied = yield* enrichmentRepo.applyMetadata(job, { coverPath: coverPaths.get(isbn) ?? null, description: data.description, publishDate: data.publishDate, publishers: data.publishers?.join(', '), numberOfPages: data.numberOfPages, openLibraryKey: data.openLibraryKey, workKey: data.workKey })
            if (!applied) {
              yield* enrichmentRepo.cancelClaim(job.id, job.claimToken, 'Book changed or was removed while enrichment was running', now)
              result.cancelled++
              continue
            }
            appliedCount++
            const tagsStartedAt = Date.now()
            const tagsResult = yield* Effect.either(bookRepo.addSystemTagsToBook(job.bookId, data.subjects ?? []))
            yield* Effect.logInfo('CSV enrichment tags hydrated').pipe(Effect.annotateLogs({
              batchId: job.batchId, bookId: job.bookId, durationMs: Date.now() - tagsStartedAt,
              outcome: tagsResult._tag === 'Right' ? 'success' : 'failure'
            }))
            if (tagsResult._tag === 'Left') {
              if (job.attempts >= job.maxAttempts) {
                yield* enrichmentRepo.markFailed(job.id, job.claimToken, tagsResult.left.message, now)
                result.failed++
              } else {
                yield* enrichmentRepo.scheduleRetry(job.id, job.claimToken, retryAt(now, job.attempts, config.backoffSeconds), tagsResult.left.message, now)
                result.retried++
              }
              continue
            }
            const coverPath = coverPaths.get(isbn) ?? null
            if (data.coverUrl && !coverPath && job.attempts < job.maxAttempts) {
              yield* enrichmentRepo.scheduleRetry(job.id, job.claimToken, retryAt(now, job.attempts, config.backoffSeconds), 'Open Library advertised a cover but it could not be stored', now)
              result.retried++
            } else if (!coverPath) {
              yield* enrichmentRepo.markCompleted(job.id, job.claimToken, 'no_cover', 'Metadata enriched; no cover is available', now)
              result.noCover++
            } else {
              yield* enrichmentRepo.markCompleted(job.id, job.claimToken, 'completed', 'Metadata and cover enriched', now)
              result.enriched++
            }
          }
          const coverPath = coverPaths.get(isbn)
          if (appliedCount === 0 && coverPath && freshlyDownloaded.has(coverPath)) {
            yield* cleanupSharedCoverIfUnreferenced(coverPath).pipe(
              Effect.catchAll(error => Effect.logWarning(`Failed to clean up unreferenced enrichment cover ${coverPath}: ${String(error)}`))
            )
          }
        }
      }).pipe(Effect.ensuring(releaseLocks))
      return result
    })

    return {
      runOwnedBatch: (userId, batchId, limit) =>
        Effect.gen(function* () {
          const claimedBookIds: string[] = []
          const progress = yield* enrichmentRepo.getBatchProgress(userId, batchId)
          if (!progress.exists) return yield* Effect.fail(new InvalidEnrichmentBatchError({ message: 'Enrichment batch was not found' }))
          yield* Effect.logInfo('CSV foreground enrichment started').pipe(Effect.annotateLogs({
            batchId, pending: progress.pending,
            batchAgeMs: progress.createdAt ? Date.now() - progress.createdAt.getTime() : null
          }))
          const result = yield* enrichImportedBooksImpl({ batchId, userId, limit, onClaimed: jobs => Effect.sync(() => claimedBookIds.push(...jobs.map(job => job.bookId))) })
          const after = yield* enrichmentRepo.getBatchProgress(userId, batchId)
          const userBookIds = claimedBookIds.length > 0
            ? yield* enrichmentRepo.getUserBookIdsForBooks(userId, claimedBookIds)
            : []
          const updates = userBookIds.length > 0
            ? yield* enrichmentRepo.getUpdatesForUserBooks(userId, userBookIds).pipe(Effect.map(rows => rows.map(toEnrichmentUpdate)))
            : []
          return { ...result, pending: after.pending, nextAttemptAt: after.nextAttemptAt, updates }
        }),

      enrichImportedBooks: enrichImportedBooksImpl,

      getUpdatesForUserBooks: (userId, userBookIds) =>
        enrichmentRepo.getUpdatesForUserBooks(userId, userBookIds).pipe(
          Effect.map(updates => updates.map(toEnrichmentUpdate))
        ),

      cleanupSharedCoverIfUnreferenced
    }
  })
)

export const enrichImportedBooks = (options?: { batchId?: string, limit?: number, userId?: string }) =>
  Effect.gen(function* () {
    const startedAt = Date.now()
    const result = yield* Effect.flatMap(BookEnrichmentService, service => service.enrichImportedBooks(options))
    yield* Effect.logInfo('Book enrichment run completed').pipe(Effect.annotateLogs({
      source: options?.userId ? 'foreground' : 'recovery', batchId: options?.batchId ?? null,
      durationMs: Date.now() - startedAt, ...result
    }))
    return result
  })

export const runOwnedEnrichmentBatch = (userId: string, batchId: string, limit?: number) =>
  Effect.gen(function* () {
    const startedAt = Date.now()
    const result = yield* Effect.flatMap(BookEnrichmentService, service => service.runOwnedBatch(userId, batchId, limit))
    yield* Effect.logInfo('Foreground enrichment batch completed').pipe(Effect.annotateLogs({
      source: 'foreground', batchId, durationMs: Date.now() - startedAt, ...result
    }))
    return result
  })

export const getBookEnrichmentUpdates = (userId: string, userBookIds: string[]) =>
  Effect.flatMap(BookEnrichmentService, service => service.getUpdatesForUserBooks(userId, userBookIds))

export const cleanupSharedCoverIfUnreferenced = (pathname: string) =>
  Effect.flatMap(BookEnrichmentService, service => service.cleanupSharedCoverIfUnreferenced(pathname))
