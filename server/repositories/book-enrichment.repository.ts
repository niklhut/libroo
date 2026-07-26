import { Context, Effect, Layer } from 'effect'
import { and, asc, eq, exists, inArray, isNull, lte, not, or, sql } from 'drizzle-orm'
import { bookEnrichmentJobs, bookEnrichmentLocks, books, loans, userBooks } from 'hub:db:schema'
import { DatabaseError } from './book.repository'
import { DbService } from '../services/db.service'

export type BookEnrichmentStatus
  = | 'pending'
    | 'processing'
    | 'retrying'
    | 'completed'
    | 'no_cover'
    | 'not_found'
    | 'failed'
    | 'cancelled'

export interface ClaimedBookEnrichmentJob {
  id: string
  batchId: string
  userId: string
  bookId: string
  isbn: string
  attempts: number
  maxAttempts: number
  claimToken: string
}

export interface EnrichmentMetadataPatch {
  coverPath: string | null
  description?: string
  publishDate?: string
  publishers?: string
  numberOfPages?: number
  openLibraryKey: string
  workKey: string | null
}

export interface BookEnrichmentUpdateRecord {
  userBookId: string
  coverPath: string | null
  status: BookEnrichmentStatus
}

export interface BookEnrichmentRepositoryInterface {
  cancelIneligibleJobs: (now: Date) => Effect.Effect<number, DatabaseError, DbService>
  claimJobs: (options: {
    limit: number
    leaseExpiresAt: Date
    now: Date
    batchId?: string
  }) => Effect.Effect<ClaimedBookEnrichmentJob[], DatabaseError, DbService>
  acquireIsbnLocks: (
    isbns: string[],
    claimToken: string,
    leaseExpiresAt: Date,
    now: Date
  ) => Effect.Effect<Set<string>, DatabaseError, DbService>
  releaseIsbnLocks: (isbns: string[], claimToken: string) => Effect.Effect<void, DatabaseError, DbService>
  applyMetadata: (
    job: ClaimedBookEnrichmentJob,
    patch: EnrichmentMetadataPatch
  ) => Effect.Effect<boolean, DatabaseError, DbService>
  markCompleted: (
    jobId: string,
    claimToken: string,
    status: 'completed' | 'no_cover' | 'not_found',
    outcome: string,
    now: Date
  ) => Effect.Effect<boolean, DatabaseError, DbService>
  scheduleRetry: (
    jobId: string,
    claimToken: string,
    nextAttemptAt: Date,
    error: string,
    now: Date
  ) => Effect.Effect<boolean, DatabaseError, DbService>
  markFailed: (
    jobId: string,
    claimToken: string,
    error: string,
    now: Date
  ) => Effect.Effect<boolean, DatabaseError, DbService>
  cancelClaim: (
    jobId: string,
    claimToken: string,
    reason: string,
    now: Date
  ) => Effect.Effect<boolean, DatabaseError, DbService>
  deferClaim: (
    jobId: string,
    claimToken: string,
    nextAttemptAt: Date,
    now: Date
  ) => Effect.Effect<boolean, DatabaseError, DbService>
  getStatusesForUserBooks: (
    userId: string,
    bookIds: string[]
  ) => Effect.Effect<Map<string, BookEnrichmentStatus>, DatabaseError, DbService>
  getUpdatesForUserBooks: (
    userId: string,
    userBookIds: string[]
  ) => Effect.Effect<BookEnrichmentUpdateRecord[], DatabaseError, DbService>
  isCoverReferenced: (pathname: string) => Effect.Effect<boolean, DatabaseError, DbService>
}

export class BookEnrichmentRepository extends Context.Tag('BookEnrichmentRepository')<
  BookEnrichmentRepository,
  BookEnrichmentRepositoryInterface
>() {}

const activeStatusCondition = inArray(bookEnrichmentJobs.status, ['pending', 'processing', 'retrying'])

function sanitizeMessage(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 500)
}

function fairCandidates<T extends { userId: string }>(rows: T[], limit: number) {
  const byUser = new Map<string, T[]>()
  for (const row of rows) {
    const items = byUser.get(row.userId) ?? []
    items.push(row)
    byUser.set(row.userId, items)
  }

  const selected: T[] = []
  while (selected.length < limit && byUser.size > 0) {
    for (const [userId, items] of byUser) {
      const next = items.shift()
      if (next) selected.push(next)
      if (items.length === 0) byUser.delete(userId)
      if (selected.length >= limit) break
    }
  }
  return selected
}

export const BookEnrichmentRepositoryLive = Layer.effect(
  BookEnrichmentRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    const activeOwnership = exists(
      dbService.db
        .select({ value: sql`1` })
        .from(userBooks)
        .where(and(
          eq(userBooks.userId, bookEnrichmentJobs.userId),
          eq(userBooks.bookId, bookEnrichmentJobs.bookId),
          isNull(userBooks.removedAt)
        ))
    )

    return {
      cancelIneligibleJobs: now =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .update(bookEnrichmentJobs)
              .set({
                status: 'cancelled',
                claimToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: null,
                lastError: 'Book is no longer eligible for enrichment',
                updatedAt: now,
                completedAt: now
              })
              .where(and(
                activeStatusCondition,
                or(
                  not(activeOwnership),
                  not(exists(
                    dbService.db
                      .select({ value: sql`1` })
                      .from(books)
                      .where(and(
                        eq(books.id, bookEnrichmentJobs.bookId),
                        eq(books.isbn, bookEnrichmentJobs.isbn),
                        eq(books.source, 'manual'),
                        eq(books.entrySource, 'csv_import')
                      ))
                  ))
                )
              ))
              .returning({ id: bookEnrichmentJobs.id })
            return rows.length
          },
          catch: error => new DatabaseError({
            message: `Failed to cancel ineligible enrichment jobs: ${error}`,
            operation: 'bookEnrichment.cancelIneligibleJobs'
          })
        }),

      claimJobs: ({ limit, leaseExpiresAt, now, batchId }) =>
        Effect.tryPromise({
          try: async () => {
            const eligible = or(
              and(
                inArray(bookEnrichmentJobs.status, ['pending', 'retrying']),
                or(isNull(bookEnrichmentJobs.nextAttemptAt), lte(bookEnrichmentJobs.nextAttemptAt, now))
              ),
              and(
                eq(bookEnrichmentJobs.status, 'processing'),
                lte(bookEnrichmentJobs.leaseExpiresAt, now)
              )
            )
            const candidates = await dbService.db
              .select({
                id: bookEnrichmentJobs.id,
                userId: bookEnrichmentJobs.userId
              })
              .from(bookEnrichmentJobs)
              .innerJoin(books, eq(books.id, bookEnrichmentJobs.bookId))
              .where(and(
                eligible,
                activeOwnership,
                eq(books.source, 'manual'),
                eq(books.entrySource, 'csv_import'),
                eq(books.isbn, bookEnrichmentJobs.isbn),
                batchId ? eq(bookEnrichmentJobs.batchId, batchId) : undefined
              ))
              .orderBy(asc(bookEnrichmentJobs.nextAttemptAt), asc(bookEnrichmentJobs.createdAt))
              .limit(Math.max(limit, limit * 10))

            const selected = fairCandidates(candidates, Math.max(1, limit))
            if (selected.length === 0) return []

            const claimToken = crypto.randomUUID()
            await dbService.executeAtomic((database) => {
              const updateJob = (candidate: { id: string }) =>
                database
                  .update(bookEnrichmentJobs)
                  .set({
                    status: 'processing',
                    attempts: sql`${bookEnrichmentJobs.attempts} + 1`,
                    claimToken,
                    leaseExpiresAt,
                    nextAttemptAt: null,
                    updatedAt: now
                  })
                  .where(and(eq(bookEnrichmentJobs.id, candidate.id), eligible))
              const [first, ...rest] = selected
              return [updateJob(first!), ...rest.map(updateJob)]
            })

            const claimed = await dbService.db
              .select({
                id: bookEnrichmentJobs.id,
                batchId: bookEnrichmentJobs.batchId,
                userId: bookEnrichmentJobs.userId,
                bookId: bookEnrichmentJobs.bookId,
                isbn: bookEnrichmentJobs.isbn,
                attempts: bookEnrichmentJobs.attempts,
                maxAttempts: bookEnrichmentJobs.maxAttempts,
                claimToken: bookEnrichmentJobs.claimToken
              })
              .from(bookEnrichmentJobs)
              .where(and(
                eq(bookEnrichmentJobs.claimToken, claimToken),
                eq(bookEnrichmentJobs.status, 'processing')
              ))

            return claimed.filter((job): job is ClaimedBookEnrichmentJob => Boolean(job.claimToken))
          },
          catch: error => new DatabaseError({
            message: `Failed to claim enrichment jobs: ${error}`,
            operation: 'bookEnrichment.claimJobs'
          })
        }),

      acquireIsbnLocks: (isbns, claimToken, leaseExpiresAt, now) =>
        Effect.tryPromise({
          try: async () => {
            if (isbns.length === 0) return new Set<string>()
            const uniqueIsbns = [...new Set(isbns)]
            await dbService.executeAtomic((database) => {
              const acquireLock = (isbn: string) =>
                database
                  .insert(bookEnrichmentLocks)
                  .values({ isbn, claimToken, leaseExpiresAt, updatedAt: now })
                  .onConflictDoUpdate({
                    target: bookEnrichmentLocks.isbn,
                    set: { claimToken, leaseExpiresAt, updatedAt: now },
                    where: lte(bookEnrichmentLocks.leaseExpiresAt, now)
                  })
              const [first, ...rest] = uniqueIsbns
              return [acquireLock(first!), ...rest.map(acquireLock)]
            })
            const rows = await dbService.db
              .select({ isbn: bookEnrichmentLocks.isbn })
              .from(bookEnrichmentLocks)
              .where(and(
                inArray(bookEnrichmentLocks.isbn, uniqueIsbns),
                eq(bookEnrichmentLocks.claimToken, claimToken)
              ))
            return new Set(rows.map(row => row.isbn))
          },
          catch: error => new DatabaseError({
            message: `Failed to acquire enrichment ISBN locks: ${error}`,
            operation: 'bookEnrichment.acquireIsbnLocks'
          })
        }),

      releaseIsbnLocks: (isbns, claimToken) =>
        Effect.tryPromise({
          try: async () => {
            if (isbns.length === 0) return
            await dbService.db
              .delete(bookEnrichmentLocks)
              .where(and(
                inArray(bookEnrichmentLocks.isbn, [...new Set(isbns)]),
                eq(bookEnrichmentLocks.claimToken, claimToken)
              ))
          },
          catch: error => new DatabaseError({
            message: `Failed to release enrichment ISBN locks: ${error}`,
            operation: 'bookEnrichment.releaseIsbnLocks'
          })
        }),

      applyMetadata: (job, patch) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .update(books)
              .set({
                coverPath: sql`coalesce(${books.coverPath}, ${patch.coverPath})`,
                description: sql`coalesce(${books.description}, ${patch.description ?? null})`,
                publishDate: sql`coalesce(${books.publishDate}, ${patch.publishDate ?? null})`,
                publishers: sql`coalesce(${books.publishers}, ${patch.publishers ?? null})`,
                numberOfPages: sql`coalesce(${books.numberOfPages}, ${patch.numberOfPages ?? null})`,
                openLibraryKey: sql`coalesce(${books.openLibraryKey}, ${patch.openLibraryKey})`,
                workKey: sql`coalesce(${books.workKey}, ${patch.workKey})`,
                metadataProviderIsbn: sql`coalesce(${books.metadataProviderIsbn}, ${job.isbn})`
              })
              .where(and(
                eq(books.id, job.bookId),
                eq(books.isbn, job.isbn),
                eq(books.source, 'manual'),
                eq(books.entrySource, 'csv_import'),
                exists(
                  dbService.db
                    .select({ value: sql`1` })
                    .from(userBooks)
                    .where(and(
                      eq(userBooks.userId, job.userId),
                      eq(userBooks.bookId, job.bookId),
                      isNull(userBooks.removedAt)
                    ))
                ),
                exists(
                  dbService.db
                    .select({ value: sql`1` })
                    .from(bookEnrichmentJobs)
                    .where(and(
                      eq(bookEnrichmentJobs.id, job.id),
                      eq(bookEnrichmentJobs.claimToken, job.claimToken),
                      eq(bookEnrichmentJobs.status, 'processing')
                    ))
                )
              ))
              .returning({ id: books.id })
            return rows.length > 0
          },
          catch: error => new DatabaseError({
            message: `Failed to apply enrichment metadata: ${error}`,
            operation: 'bookEnrichment.applyMetadata'
          })
        }),

      markCompleted: (jobId, claimToken, status, outcome, now) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .update(bookEnrichmentJobs)
              .set({
                status,
                claimToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: null,
                lastError: null,
                outcome: sanitizeMessage(outcome),
                updatedAt: now,
                completedAt: now
              })
              .where(and(
                eq(bookEnrichmentJobs.id, jobId),
                eq(bookEnrichmentJobs.status, 'processing'),
                eq(bookEnrichmentJobs.claimToken, claimToken)
              ))
              .returning({ id: bookEnrichmentJobs.id })
            return rows.length > 0
          },
          catch: error => new DatabaseError({
            message: `Failed to complete enrichment job: ${error}`,
            operation: 'bookEnrichment.markCompleted'
          })
        }),

      scheduleRetry: (jobId, claimToken, nextAttemptAt, error, now) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .update(bookEnrichmentJobs)
              .set({
                status: 'retrying',
                claimToken: null,
                leaseExpiresAt: null,
                nextAttemptAt,
                lastError: sanitizeMessage(error),
                updatedAt: now,
                completedAt: null
              })
              .where(and(
                eq(bookEnrichmentJobs.id, jobId),
                eq(bookEnrichmentJobs.status, 'processing'),
                eq(bookEnrichmentJobs.claimToken, claimToken)
              ))
              .returning({ id: bookEnrichmentJobs.id })
            return rows.length > 0
          },
          catch: error => new DatabaseError({
            message: `Failed to schedule enrichment retry: ${error}`,
            operation: 'bookEnrichment.scheduleRetry'
          })
        }),

      markFailed: (jobId, claimToken, error, now) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .update(bookEnrichmentJobs)
              .set({
                status: 'failed',
                claimToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: null,
                lastError: sanitizeMessage(error),
                updatedAt: now,
                completedAt: now
              })
              .where(and(
                eq(bookEnrichmentJobs.id, jobId),
                eq(bookEnrichmentJobs.status, 'processing'),
                eq(bookEnrichmentJobs.claimToken, claimToken)
              ))
              .returning({ id: bookEnrichmentJobs.id })
            return rows.length > 0
          },
          catch: error => new DatabaseError({
            message: `Failed to fail enrichment job: ${error}`,
            operation: 'bookEnrichment.markFailed'
          })
        }),

      cancelClaim: (jobId, claimToken, reason, now) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .update(bookEnrichmentJobs)
              .set({
                status: 'cancelled',
                claimToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: null,
                lastError: sanitizeMessage(reason),
                updatedAt: now,
                completedAt: now
              })
              .where(and(
                eq(bookEnrichmentJobs.id, jobId),
                eq(bookEnrichmentJobs.status, 'processing'),
                eq(bookEnrichmentJobs.claimToken, claimToken)
              ))
              .returning({ id: bookEnrichmentJobs.id })
            return rows.length > 0
          },
          catch: error => new DatabaseError({
            message: `Failed to cancel enrichment claim: ${error}`,
            operation: 'bookEnrichment.cancelClaim'
          })
        }),

      deferClaim: (jobId, claimToken, nextAttemptAt, now) =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .update(bookEnrichmentJobs)
              .set({
                status: 'retrying',
                attempts: sql`max(0, ${bookEnrichmentJobs.attempts} - 1)`,
                claimToken: null,
                leaseExpiresAt: null,
                nextAttemptAt,
                updatedAt: now
              })
              .where(and(
                eq(bookEnrichmentJobs.id, jobId),
                eq(bookEnrichmentJobs.status, 'processing'),
                eq(bookEnrichmentJobs.claimToken, claimToken)
              ))
              .returning({ id: bookEnrichmentJobs.id })
            return rows.length > 0
          },
          catch: error => new DatabaseError({
            message: `Failed to defer enrichment claim: ${error}`,
            operation: 'bookEnrichment.deferClaim'
          })
        }),

      getStatusesForUserBooks: (userId, bookIds) =>
        Effect.tryPromise({
          try: async () => {
            if (bookIds.length === 0) return new Map<string, BookEnrichmentStatus>()
            const rows = await dbService.db
              .select({
                bookId: bookEnrichmentJobs.bookId,
                status: bookEnrichmentJobs.status
              })
              .from(bookEnrichmentJobs)
              .innerJoin(userBooks, and(
                eq(userBooks.bookId, bookEnrichmentJobs.bookId),
                eq(userBooks.userId, bookEnrichmentJobs.userId)
              ))
              .where(and(
                eq(bookEnrichmentJobs.userId, userId),
                inArray(bookEnrichmentJobs.bookId, bookIds),
                isNull(userBooks.removedAt)
              ))
            return new Map(rows.map(row => [row.bookId, row.status as BookEnrichmentStatus]))
          },
          catch: error => new DatabaseError({
            message: `Failed to load enrichment statuses: ${error}`,
            operation: 'bookEnrichment.getStatusesForUserBooks'
          })
        }),

      getUpdatesForUserBooks: (userId, userBookIds) =>
        Effect.tryPromise({
          try: async () => {
            if (userBookIds.length === 0) return []
            return dbService.db
              .select({
                userBookId: userBooks.id,
                coverPath: books.coverPath,
                status: bookEnrichmentJobs.status
              })
              .from(userBooks)
              .innerJoin(books, eq(books.id, userBooks.bookId))
              .innerJoin(bookEnrichmentJobs, and(
                eq(bookEnrichmentJobs.bookId, books.id),
                eq(bookEnrichmentJobs.userId, userId)
              ))
              .where(and(
                inArray(userBooks.id, userBookIds),
                eq(userBooks.userId, userId),
                isNull(userBooks.removedAt)
              ))
          },
          catch: error => new DatabaseError({
            message: `Failed to load enrichment updates: ${error}`,
            operation: 'bookEnrichment.getUpdatesForUserBooks'
          })
        }),

      isCoverReferenced: pathname =>
        Effect.tryPromise({
          try: async () => {
            const [bookRows, loanRows] = await Promise.all([
              dbService.db.select({ id: books.id }).from(books).where(eq(books.coverPath, pathname)).limit(1),
              dbService.db.select({ id: loans.id }).from(loans).where(eq(loans.snapshotCoverPath, pathname)).limit(1)
            ])
            return Boolean(bookRows[0] || loanRows[0])
          },
          catch: error => new DatabaseError({
            message: `Failed to check cover references: ${error}`,
            operation: 'bookEnrichment.isCoverReferenced'
          })
        })
    }
  })
)
