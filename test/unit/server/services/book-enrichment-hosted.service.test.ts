import { Effect, Layer } from 'effect'
import { expect, it, vi } from 'vitest'
import { BookEnrichmentRepository, type BookEnrichmentRepositoryInterface } from '../../../../server/repositories/book-enrichment.repository'
import { BookRepository, type BookRepositoryInterface } from '../../../../server/repositories/book.repository'
import { OpenLibraryRepository, type OpenLibraryRepositoryInterface } from '../../../../server/repositories/openLibrary.repository'
import { BookEnrichmentServiceLive, runOwnedEnrichmentBatch } from '../../../../server/services/book-enrichment.service'

vi.mock('../../../../server/runtime/profile.active', () => ({ runtimeProfile: 'cloudflare' }))

it('hosted progress does not claim work', async () => {
  const claimJobs = vi.fn()
  const repo = { getBatchProgress: () => Effect.succeed({ exists: true, pending: 2, nextAttemptAt: null, createdAt: null }), getBatchUserBookIds: () => Effect.succeed([]), getUpdatesForUserBooks: () => Effect.succeed([]), claimJobs } as unknown as BookEnrichmentRepositoryInterface
  const result = await Effect.runPromise(runOwnedEnrichmentBatch('u', 'b').pipe(Effect.provide(BookEnrichmentServiceLive), Effect.provide(Layer.mergeAll(Layer.succeed(BookEnrichmentRepository, repo), Layer.succeed(BookRepository, {} as BookRepositoryInterface), Layer.succeed(OpenLibraryRepository, {} as OpenLibraryRepositoryInterface)))))
  expect(result.claimed).toBe(0)
  expect(result.pending).toBe(2)
  expect(claimJobs).not.toHaveBeenCalled()
})
