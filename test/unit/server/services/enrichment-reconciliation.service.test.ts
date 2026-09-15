import { Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { BookEnrichmentRepository } from '../../../../server/repositories/book-enrichment.repository'
import { CanonicalBookEnrichmentRepository } from '../../../../server/repositories/canonical-book-enrichment.repository'
import { EnrichmentDispatchService } from '../../../../server/services/enrichment-dispatch.service'
import { EnrichmentReconciliationService, EnrichmentReconciliationServiceLive } from '../../../../server/services/enrichment-reconciliation.service'

type ImportedJob = { id: string, attempts: number, isbn: string, userId: string, batchId: string }
type CanonicalJob = { bookId: string, attempts: number, isbn: string }
const run = (jobs: ImportedJob[], canonicalJobs: CanonicalJob[], dispatch: ReturnType<typeof vi.fn>) =>
  Effect.runPromise(Effect.gen(function* () {
    const service = yield* EnrichmentReconciliationService
    return yield* service.reconcile()
  }).pipe(
    Effect.provide(EnrichmentReconciliationServiceLive),
    Effect.provide(Layer.succeed(BookEnrichmentRepository, { cancelIneligibleJobs: () => Effect.succeed(0), listRecoverableDispatch: () => Effect.succeed(jobs) } as never)),
    Effect.provide(Layer.succeed(CanonicalBookEnrichmentRepository, { listRecoverable: () => Effect.succeed(canonicalJobs) } as never)),
    Effect.provide(Layer.succeed(EnrichmentDispatchService, { dispatch } as never))
  ))

describe('EnrichmentReconciliationService', () => {
  it('publishes imported and canonical jobs with the next attempt identity', async () => {
    const dispatch = vi.fn(() => Effect.succeed(true))
    const result = await run([{ id: 'j1', attempts: 2, isbn: '111', userId: 'u', batchId: 'b' }], [{ bookId: 'c1', attempts: 1, isbn: '222' }], dispatch)
    expect(result).toEqual({ dispatched: 2 })
    expect(dispatch.mock.calls.map(([message]) => message)).toEqual([
      { kind: 'imported', jobId: 'j1', attempt: 3, isbn: '111', userId: 'u', batchId: 'b' },
      { kind: 'canonical', jobId: 'c1', attempt: 2, isbn: '222' }
    ])
  })

  it('does not count failed dispatches and republishes the same identity', async () => {
    const dispatch = vi.fn(() => Effect.succeed(false))
    const jobs = [{ id: 'j1', attempts: 0, isbn: '111', userId: 'u', batchId: 'b' }]
    expect(await run(jobs, [], dispatch)).toEqual({ dispatched: 0 })
    expect(await run(jobs, [], dispatch)).toEqual({ dispatched: 0 })
    expect(dispatch.mock.calls).toHaveLength(2)
    expect(dispatch.mock.calls[0]![0]).toEqual(dispatch.mock.calls[1]![0])
  })

  it('returns zero when no recoverable jobs exist', async () => {
    const dispatch = vi.fn(() => Effect.succeed(true))
    expect(await run([], [], dispatch)).toEqual({ dispatched: 0 })
    expect(dispatch).not.toHaveBeenCalled()
  })
})
