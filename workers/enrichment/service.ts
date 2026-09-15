import { Context, Data, Effect, Layer } from 'effect'
import type * as HttpClient from '@effect/platform/HttpClient'
import { BookEnrichmentRepository, type ClaimedBookEnrichmentJob } from '../../server/repositories/book-enrichment.repository'
import { CanonicalBookEnrichmentRepository, type CanonicalBookEnrichmentJob } from '../../server/repositories/canonical-book-enrichment.repository'
import { workflowId, type EnrichmentQueueMessage } from './protocol'
import { createWorkerRuntime, type WorkerRuntimeEnv } from './runtime'
import type { BookNotFoundError, DatabaseError } from '../../server/repositories/book.repository'
import { BookRepository } from '../../server/repositories/book.repository'
import type { OpenLibraryApiError, OpenLibraryCoverError } from '../../server/repositories/openLibrary.repository'
import { OpenLibraryRepository } from '../../server/repositories/openLibrary.repository'
import type { DbService } from '../../server/services/db.service'
import type { StorageService } from '../../server/services/storage.service'
import type { OpenLibraryBookData } from '../../shared/types/open-library'

export type WorkerEnv = WorkerRuntimeEnv
export type WorkerClaim = { kind: 'imported', token: string, job: ClaimedBookEnrichmentJob }
  | { kind: 'canonical', token: string, job: CanonicalBookEnrichmentJob }
export class LostEnrichmentClaimError extends Data.TaggedError('LostEnrichmentClaimError')<{ jobId: string }> {}
type WorkerServices = BookEnrichmentRepository | CanonicalBookEnrichmentRepository | BookRepository | OpenLibraryRepository | DbService | StorageService | HttpClient.HttpClient

export interface WorkerEnrichmentServiceInterface {
  renewEnrichmentClaim: (claim: WorkerClaim) => Effect.Effect<void, WorkerEnrichmentError, WorkerServices>
  lookupEnrichmentMetadata: (claim: WorkerClaim) => Effect.Effect<OpenLibraryBookData | null, WorkerEnrichmentError, WorkerServices>
  storeEnrichmentCover: (claim: WorkerClaim, data: OpenLibraryBookData) => Effect.Effect<string | null, WorkerEnrichmentError, WorkerServices>
  persistEnrichmentMetadata: (claim: WorkerClaim, data: OpenLibraryBookData, coverPath: string | null) => Effect.Effect<boolean, WorkerEnrichmentError, WorkerServices>
  addEnrichmentTags: (claim: WorkerClaim, data: OpenLibraryBookData) => Effect.Effect<void, WorkerEnrichmentError, WorkerServices>
  completeEnrichmentJob: (claim: WorkerClaim, status: 'completed' | 'no_cover' | 'not_found') => Effect.Effect<void, WorkerEnrichmentError, WorkerServices>
  failEnrichmentJob: (claim: WorkerClaim, error: string) => Effect.Effect<void, WorkerEnrichmentError, WorkerServices>
  releaseEnrichmentClaimLock: (claim: WorkerClaim) => Effect.Effect<void, WorkerEnrichmentError, WorkerServices>
  claimEnrichmentJob: (message: EnrichmentQueueMessage) => Effect.Effect<WorkerClaim | null, WorkerEnrichmentError, WorkerServices>
}

export class WorkerEnrichmentService extends Context.Tag('WorkerEnrichmentService')<WorkerEnrichmentService, WorkerEnrichmentServiceInterface>() {}
type WorkerEnrichmentError = DatabaseError | BookNotFoundError | OpenLibraryApiError | OpenLibraryCoverError | LostEnrichmentClaimError

export const WorkerEnrichmentServiceLive = Layer.succeed(WorkerEnrichmentService, {
  renewEnrichmentClaim: claim => Effect.gen(function* () {
    const now = new Date()
    const expiry = new Date(now.getTime() + 15 * 60 * 1000)
    const jobs = yield* BookEnrichmentRepository
    const valid = claim.kind === 'canonical'
      ? yield* (yield* CanonicalBookEnrichmentRepository).renew(claim.job.bookId, claim.token, expiry, now)
      : yield* jobs.renewClaim(claim.job.id, claim.token, expiry, now)
    const locked = yield* jobs.renewIsbnLock(claim.job.isbn, claim.token, now, expiry)
    if (!valid || !locked) return yield* Effect.fail(new LostEnrichmentClaimError({ jobId: claim.job.bookId }))
  }),
  lookupEnrichmentMetadata: claim => Effect.gen(function* () {
    yield* renewEnrichmentClaimEffect(claim)
    const book = yield* BookRepository
    yield* book.getBookById(claim.job.bookId)
    const repo = yield* OpenLibraryRepository
    return yield* repo.lookupByISBN(claim.job.isbn, 'enrichment').pipe(Effect.catchTag('OpenLibraryBookNotFoundError', () => Effect.succeed(null)))
  }),
  storeEnrichmentCover: (claim, data) => Effect.gen(function* () {
    yield* renewEnrichmentClaimEffect(claim)
    const books = yield* BookRepository
    const existing = yield* books.findStoredOpenLibraryCover(claim.job.isbn)
    if (existing || !data.coverUrl) return existing
    return yield* (yield* OpenLibraryRepository).downloadCover(claim.job.isbn, 'L', data.coverUrl, 'enrichment')
  }),
  persistEnrichmentMetadata: (claim, data, coverPath) => Effect.gen(function* () {
    yield* renewEnrichmentClaimEffect(claim)
    if (claim.kind === 'canonical') {
      yield* (yield* BookRepository).applyOpenLibraryEnrichment(claim.job.bookId, data, coverPath, { claimToken: claim.token, isbn: claim.job.isbn, now: new Date() })
      return true
    }
    const applied = yield* (yield* BookEnrichmentRepository).applyMetadata(claim.job, {
      coverPath,
      description: data.description,
      publishDate: data.publishDate,
      publishers: data.publishers?.length ? JSON.stringify(data.publishers) : undefined,
      numberOfPages: data.numberOfPages,
      openLibraryKey: data.openLibraryKey,
      workKey: data.workKey
    })
    if (!applied) yield* (yield* BookEnrichmentRepository).cancelClaim(claim.job.id, claim.token, 'Book changed or was removed while enrichment was running', new Date())
    return applied
  }),
  addEnrichmentTags: (claim, data) => Effect.gen(function* () {
    yield* renewEnrichmentClaimEffect(claim)
    yield* (yield* BookRepository).addSystemTagsToBook(claim.job.bookId, data.subjects ?? [])
  }),
  completeEnrichmentJob: (claim, status) => Effect.gen(function* () {
    const now = new Date()
    if (claim.kind === 'canonical') yield* (yield* CanonicalBookEnrichmentRepository).complete(claim.job.bookId, claim.token, status, null, now)
    else yield* (yield* BookEnrichmentRepository).markCompleted(claim.job.id, claim.token, status, status === 'completed' ? 'Metadata and cover enriched' : status === 'not_found' ? 'Open Library has no record for this ISBN' : 'Metadata enriched; no cover is available', now)
    yield* releaseEnrichmentClaimLockEffect(claim)
  }),
  failEnrichmentJob: (claim, error) => Effect.gen(function* () {
    const now = new Date()
    const next = new Date(now.getTime() + 60_000)
    if (claim.kind === 'canonical') yield* (yield* CanonicalBookEnrichmentRepository).retry(claim.job.bookId, claim.token, next, error, now)
    else {
      const repository = yield* BookEnrichmentRepository
      if (claim.job.attempts >= claim.job.maxAttempts) yield* repository.markFailed(claim.job.id, claim.token, error, now)
      else yield* repository.scheduleRetry(claim.job.id, claim.token, next, error, now)
    }
    yield* releaseEnrichmentClaimLockEffect(claim)
  }),
  releaseEnrichmentClaimLock: claim => releaseEnrichmentClaimLockEffect(claim),
  claimEnrichmentJob: (message) => {
    const token = workflowId(message)
    return Effect.gen(function* () {
      const now = new Date()
      const expiry = new Date(now.getTime() + 15 * 60 * 1000)
      const repo = yield* BookEnrichmentRepository
      if (message.kind === 'canonical') {
        const canonical = yield* CanonicalBookEnrichmentRepository
        const job = yield* canonical.claimForWorkflow(message.jobId, message.attempt, token, now, expiry)
        if (!job) return null
        const locks = yield* repo.acquireIsbnLocks([job.isbn], token, expiry, now)
        if (!locks.has(job.isbn)) {
          yield* canonical.retry(job.bookId, token, new Date(now.getTime() + 15_000), 'ISBN is currently being enriched by another workflow', now)
          return null
        }
        return { kind: 'canonical', token, job } as const
      }
      const job = yield* repo.claimJob(message.jobId, message.attempt, token, now, expiry)
      if (!job) return null
      const locks = yield* repo.acquireIsbnLocks([job.isbn], token, expiry, now)
      if (!locks.has(job.isbn)) {
        yield* repo.scheduleRetry(job.id, token, new Date(now.getTime() + 15_000), 'ISBN is currently being enriched by another workflow', now)
        return null
      }
      return { kind: 'imported', token, job } as const
    })
  }
})

function run<A, E>(effect: Effect.Effect<A, E, WorkerServices | WorkerEnrichmentService>, env: WorkerEnv): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(WorkerEnrichmentServiceLive), Effect.provide(createWorkerRuntime(env))))
}

export function renewEnrichmentClaim(claim: WorkerClaim, env: WorkerEnv): Promise<void> {
  return run(Effect.flatMap(WorkerEnrichmentService, service => service.renewEnrichmentClaim(claim)), env)
}

export function lookupEnrichmentMetadata(claim: WorkerClaim, env: WorkerEnv): Promise<OpenLibraryBookData | null> {
  return run(Effect.flatMap(WorkerEnrichmentService, service => service.lookupEnrichmentMetadata(claim)), env)
}

function renewEnrichmentClaimEffect(claim: WorkerClaim) {
  return Effect.gen(function* () {
    const now = new Date()
    const expiry = new Date(now.getTime() + 15 * 60 * 1000)
    const jobs = yield* BookEnrichmentRepository
    const valid = claim.kind === 'canonical' ? yield* (yield* CanonicalBookEnrichmentRepository).renew(claim.job.bookId, claim.token, expiry, now) : yield* jobs.renewClaim(claim.job.id, claim.token, expiry, now)
    const locked = yield* jobs.renewIsbnLock(claim.job.isbn, claim.token, now, expiry)
    if (!valid || !locked) return yield* Effect.fail(new LostEnrichmentClaimError({ jobId: claim.job.bookId }))
  })
}

export function storeEnrichmentCover(claim: WorkerClaim, data: OpenLibraryBookData, env: WorkerEnv): Promise<string | null> {
  return run(Effect.flatMap(WorkerEnrichmentService, service => service.storeEnrichmentCover(claim, data)), env)
}

export function persistEnrichmentMetadata(claim: WorkerClaim, data: OpenLibraryBookData, coverPath: string | null, env: WorkerEnv): Promise<boolean> {
  return run(Effect.flatMap(WorkerEnrichmentService, service => service.persistEnrichmentMetadata(claim, data, coverPath)), env)
}

export function addEnrichmentTags(claim: WorkerClaim, data: OpenLibraryBookData, env: WorkerEnv): Promise<void> {
  return run(Effect.flatMap(WorkerEnrichmentService, service => service.addEnrichmentTags(claim, data)), env)
}

export function completeEnrichmentJob(claim: WorkerClaim, status: 'completed' | 'no_cover' | 'not_found', env: WorkerEnv): Promise<void> {
  return run(Effect.flatMap(WorkerEnrichmentService, service => service.completeEnrichmentJob(claim, status)), env)
}

export function failEnrichmentJob(claim: WorkerClaim, error: string, env: WorkerEnv): Promise<void> {
  return run(Effect.flatMap(WorkerEnrichmentService, service => service.failEnrichmentJob(claim, error)), env)
}

function releaseEnrichmentClaimLockEffect(claim: WorkerClaim) {
  return Effect.gen(function* () {
    yield* (yield* BookEnrichmentRepository).releaseIsbnLocks([claim.job.isbn], claim.token)
  })
}

export function releaseEnrichmentClaimLock(claim: WorkerClaim, env: WorkerEnv): Promise<void> {
  return run(Effect.flatMap(WorkerEnrichmentService, service => service.releaseEnrichmentClaimLock(claim)), env)
}

/** Claim exactly one persisted job and reserve its ISBN for this workflow. */
export function claimEnrichmentJob(message: EnrichmentQueueMessage, env: WorkerEnv): Promise<WorkerClaim | null> {
  return run(Effect.flatMap(WorkerEnrichmentService, service => service.claimEnrichmentJob(message)), env)
}
