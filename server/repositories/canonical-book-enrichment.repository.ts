import { Context, Effect, Layer } from 'effect'
import { and, asc, eq, lt, lte, or, sql } from 'drizzle-orm'
import { canonicalBookEnrichmentJobs } from 'hub:db:schema'
import type { BookEnrichmentStatus } from '../../shared/types/book'
import { DbService } from '../services/db.service'
import { DatabaseError } from './book.repository'

export interface CanonicalBookEnrichmentJob {
  bookId: string
  isbn: string
  status: BookEnrichmentStatus
  attempts: number
  maxAttempts: number
  claimToken: string | null
  leaseExpiresAt: Date | null
  nextAttemptAt: Date | null
  lastError: string | null
}

export class CanonicalBookEnrichmentRepository extends Context.Tag('CanonicalBookEnrichmentRepository')<
  CanonicalBookEnrichmentRepository,
  {
    ensurePending: (bookId: string, isbn: string) => Effect.Effect<CanonicalBookEnrichmentJob, DatabaseError, DbService>
    get: (bookId: string) => Effect.Effect<CanonicalBookEnrichmentJob | null, DatabaseError, DbService>
    listRecoverable: (now: Date, limit: number) => Effect.Effect<CanonicalBookEnrichmentJob[], DatabaseError, DbService>
    claim: (bookId: string, now: Date, leaseExpiresAt: Date) => Effect.Effect<CanonicalBookEnrichmentJob | null, DatabaseError, DbService>
    complete: (bookId: string, claimToken: string, status: 'completed' | 'no_cover' | 'not_found', error: string | null, now: Date) => Effect.Effect<void, DatabaseError, DbService>
    retry: (bookId: string, claimToken: string, nextAttemptAt: Date, error: string, now: Date) => Effect.Effect<void, DatabaseError, DbService>
  }
>() {}

const toJob = (row: typeof canonicalBookEnrichmentJobs.$inferSelect): CanonicalBookEnrichmentJob => ({
  bookId: row.bookId,
  isbn: row.isbn,
  status: row.status as BookEnrichmentStatus,
  attempts: row.attempts,
  maxAttempts: row.maxAttempts,
  claimToken: row.claimToken,
  leaseExpiresAt: row.leaseExpiresAt,
  nextAttemptAt: row.nextAttemptAt,
  lastError: row.lastError
})

export const CanonicalBookEnrichmentRepositoryLive = Layer.effect(
  CanonicalBookEnrichmentRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService
    const get = (bookId: string) => Effect.tryPromise({
      try: async () => {
        const rows = await dbService.db.select().from(canonicalBookEnrichmentJobs).where(eq(canonicalBookEnrichmentJobs.bookId, bookId)).limit(1)
        return rows[0] ? toJob(rows[0]) : null
      },
      catch: error => new DatabaseError({ message: `Failed to load canonical enrichment job: ${error}`, operation: 'canonicalEnrichment.get' })
    })

    return {
      get,
      listRecoverable: (now, limit) => Effect.tryPromise({
        try: async () => {
          const rows = await dbService.db.select().from(canonicalBookEnrichmentJobs).where(or(
            eq(canonicalBookEnrichmentJobs.status, 'pending'),
            and(eq(canonicalBookEnrichmentJobs.status, 'retrying'), lte(canonicalBookEnrichmentJobs.nextAttemptAt, now)),
            and(eq(canonicalBookEnrichmentJobs.status, 'processing'), lte(canonicalBookEnrichmentJobs.leaseExpiresAt, now))
          )).orderBy(
            sql`CASE
              WHEN ${canonicalBookEnrichmentJobs.status} = 'retrying' THEN 0
              WHEN ${canonicalBookEnrichmentJobs.status} = 'processing' THEN 1
              ELSE 2
            END`,
            sql`CASE
              WHEN ${canonicalBookEnrichmentJobs.status} = 'retrying' THEN ${canonicalBookEnrichmentJobs.nextAttemptAt}
              WHEN ${canonicalBookEnrichmentJobs.status} = 'processing' THEN ${canonicalBookEnrichmentJobs.leaseExpiresAt}
              ELSE ${canonicalBookEnrichmentJobs.createdAt}
            END`,
            asc(canonicalBookEnrichmentJobs.bookId)
          ).limit(limit)
          return rows.map(toJob)
        },
        catch: error => new DatabaseError({ message: `Failed to list recoverable canonical enrichment jobs: ${error}`, operation: 'canonicalEnrichment.listRecoverable' })
      }),
      ensurePending: (bookId, isbn) => Effect.gen(function* () {
        const now = new Date()
        yield* Effect.tryPromise({
          try: () => dbService.db.insert(canonicalBookEnrichmentJobs).values({
            bookId,
            isbn,
            status: 'pending',
            attempts: 0,
            maxAttempts: 5,
            createdAt: now,
            updatedAt: now
          }).onConflictDoNothing(),
          catch: error => new DatabaseError({ message: `Failed to persist canonical enrichment job: ${error}`, operation: 'canonicalEnrichment.ensurePending' })
        })
        const job = yield* get(bookId)
        if (!job) return yield* Effect.fail(new DatabaseError({ message: 'Canonical enrichment job was not persisted', operation: 'canonicalEnrichment.ensurePending.resolve' }))
        return job
      }),
      claim: (bookId, now, leaseExpiresAt) => Effect.gen(function* () {
        const token = crypto.randomUUID()
        const claimed = yield* Effect.tryPromise({
          try: () => dbService.db.update(canonicalBookEnrichmentJobs).set({
            status: 'processing',
            claimToken: token,
            attempts: sql`${canonicalBookEnrichmentJobs.attempts} + 1`,
            leaseExpiresAt,
            updatedAt: now,
            lastError: null
          }).where(and(
            eq(canonicalBookEnrichmentJobs.bookId, bookId),
            lt(canonicalBookEnrichmentJobs.attempts, canonicalBookEnrichmentJobs.maxAttempts),
            or(
              eq(canonicalBookEnrichmentJobs.status, 'pending'),
              and(eq(canonicalBookEnrichmentJobs.status, 'retrying'), lte(canonicalBookEnrichmentJobs.nextAttemptAt, now)),
              and(eq(canonicalBookEnrichmentJobs.status, 'processing'), lte(canonicalBookEnrichmentJobs.leaseExpiresAt, now))
            )
          )).returning(),
          catch: error => new DatabaseError({ message: `Failed to claim canonical enrichment: ${error}`, operation: 'canonicalEnrichment.claim' })
        })
        return claimed[0] ? toJob(claimed[0]) : null
      }),
      complete: (bookId, claimToken, status, error, now) =>
        Effect.tryPromise({
          try: () => dbService.db.update(canonicalBookEnrichmentJobs).set({
            status,
            lastError: error,
            claimToken: null,
            leaseExpiresAt: null,
            completedAt: now,
            updatedAt: now
          }).where(and(eq(canonicalBookEnrichmentJobs.bookId, bookId), eq(canonicalBookEnrichmentJobs.claimToken, claimToken))),
          catch: error => new DatabaseError({ message: `Failed to complete canonical enrichment: ${error}`, operation: 'canonicalEnrichment.complete' })
        }).pipe(Effect.asVoid),
      retry: (bookId, claimToken, nextAttemptAt, error, now) =>
        Effect.tryPromise({
          try: () => dbService.db.update(canonicalBookEnrichmentJobs).set({
            status: sql`CASE WHEN ${canonicalBookEnrichmentJobs.attempts} >= ${canonicalBookEnrichmentJobs.maxAttempts} THEN 'failed' ELSE 'retrying' END`,
            lastError: error,
            nextAttemptAt: sql`CASE WHEN ${canonicalBookEnrichmentJobs.attempts} >= ${canonicalBookEnrichmentJobs.maxAttempts} THEN NULL ELSE ${nextAttemptAt.getTime()} END`,
            claimToken: null,
            leaseExpiresAt: null,
            completedAt: sql`CASE WHEN ${canonicalBookEnrichmentJobs.attempts} >= ${canonicalBookEnrichmentJobs.maxAttempts} THEN ${now.getTime()} ELSE NULL END`,
            updatedAt: now
          }).where(and(eq(canonicalBookEnrichmentJobs.bookId, bookId), eq(canonicalBookEnrichmentJobs.claimToken, claimToken))),
          catch: error => new DatabaseError({ message: `Failed to retry canonical enrichment: ${error}`, operation: 'canonicalEnrichment.retry' })
        }).pipe(Effect.asVoid)
    }
  })
)
