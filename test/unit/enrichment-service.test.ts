import { Effect, Layer } from 'effect'
import { expect, it, vi } from 'vitest'
import { BookEnrichmentRepository } from '../../server/repositories/book-enrichment.repository'
import { CanonicalBookEnrichmentRepository } from '../../server/repositories/canonical-book-enrichment.repository'
import { BookRepository } from '../../server/repositories/book.repository'
import { OpenLibraryRepository } from '../../server/repositories/openLibrary.repository'
import { createWorkerRuntime } from '../../workers/enrichment/runtime'
import { failEnrichmentJob, claimEnrichmentJob, type WorkerEnv, type WorkerClaim } from '../../workers/enrichment/service'
import { persistEnrichmentMetadata, addEnrichmentTags } from '../../workers/enrichment/service'

vi.mock('../../workers/enrichment/runtime', () => ({ createWorkerRuntime: vi.fn() }))

it('marks imported jobs failed at max attempts instead of scheduling another retry', async () => {
  const markFailed = vi.fn(() => Effect.succeed(true))
  const scheduleRetry = vi.fn(() => Effect.succeed(true))
  vi.mocked(createWorkerRuntime).mockReturnValue(Layer.mergeAll(
    Layer.succeed(BookEnrichmentRepository, { markFailed, scheduleRetry, releaseIsbnLocks: vi.fn(() => Effect.void) } as never),
    Layer.succeed(CanonicalBookEnrichmentRepository, {} as never), Layer.succeed(BookRepository, {} as never), Layer.succeed(OpenLibraryRepository, {} as never)
  ) as never)
  const claim = { kind: 'imported', token: 'token', job: { id: 'job', bookId: 'book', isbn: 'isbn', attempts: 5, maxAttempts: 5 } } as WorkerClaim
  await failEnrichmentJob(claim, 'provider failed', {} as WorkerEnv)
  expect(markFailed).toHaveBeenCalled()
  expect(scheduleRetry).not.toHaveBeenCalled()
})

it('schedules a retry when the ISBN lock cannot be acquired', async () => {
  const scheduleRetry = vi.fn(() => Effect.succeed(true))
  const deferClaim = vi.fn(() => Effect.succeed(true))
  vi.mocked(createWorkerRuntime).mockReturnValue(Layer.mergeAll(
    Layer.succeed(BookEnrichmentRepository, { claimJob: vi.fn(() => Effect.succeed({ id: 'job', bookId: 'book', isbn: 'isbn', attempts: 1, maxAttempts: 5 })), acquireIsbnLocks: vi.fn(() => Effect.succeed(new Set())), scheduleRetry, deferClaim } as never),
    Layer.succeed(CanonicalBookEnrichmentRepository, {} as never), Layer.succeed(BookRepository, {} as never), Layer.succeed(OpenLibraryRepository, {} as never)
  ) as never)
  expect(await claimEnrichmentJob({ kind: 'imported', jobId: 'job', attempt: 1 }, {} as WorkerEnv)).toBeNull()
  expect(scheduleRetry).toHaveBeenCalled()
  expect(deferClaim).not.toHaveBeenCalled()
})

it('cancels an imported claim when conditional persistence declines it', async () => {
  const cancelClaim = vi.fn(() => Effect.succeed(true))
  vi.mocked(createWorkerRuntime).mockReturnValue(Layer.mergeAll(
    Layer.succeed(BookEnrichmentRepository, { renewClaim: vi.fn(() => Effect.succeed(true)), renewIsbnLock: vi.fn(() => Effect.succeed(true)), applyMetadata: vi.fn(() => Effect.succeed(false)), cancelClaim, releaseIsbnLocks: vi.fn(() => Effect.void) } as never),
    Layer.succeed(CanonicalBookEnrichmentRepository, {} as never), Layer.succeed(BookRepository, {} as never), Layer.succeed(OpenLibraryRepository, {} as never)
  ) as never)
  const claim = { kind: 'imported', token: 'token', job: { id: 'job', bookId: 'book', isbn: 'isbn', attempts: 1, maxAttempts: 5 } } as WorkerClaim
  expect(await persistEnrichmentMetadata(claim, { openLibraryKey: 'x', workKey: null } as never, null, {} as WorkerEnv)).toBe(false)
  expect(cancelClaim).toHaveBeenCalled()
})

it('blocks tag writes when the lease renewal is lost', async () => {
  const addSystemTagsToBook = vi.fn(() => Effect.succeed(undefined))
  vi.mocked(createWorkerRuntime).mockReturnValue(Layer.mergeAll(
    Layer.succeed(BookEnrichmentRepository, { renewClaim: vi.fn(() => Effect.succeed(false)), renewIsbnLock: vi.fn(() => Effect.succeed(true)), releaseIsbnLocks: vi.fn(() => Effect.void) } as never),
    Layer.succeed(CanonicalBookEnrichmentRepository, {} as never), Layer.succeed(BookRepository, { addSystemTagsToBook } as never), Layer.succeed(OpenLibraryRepository, {} as never)
  ) as never)
  const claim = { kind: 'imported', token: 'token', job: { id: 'job', bookId: 'book', isbn: 'isbn', attempts: 1, maxAttempts: 5 } } as WorkerClaim
  await expect(addEnrichmentTags(claim, { subjects: ['tag'] } as never, {} as WorkerEnv)).rejects.toBeDefined()
  expect(addSystemTagsToBook).not.toHaveBeenCalled()
})
