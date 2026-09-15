import { Context, Effect, Layer } from 'effect'
import { BookEnrichmentRepository } from '../repositories/book-enrichment.repository'
import { EnrichmentDispatchService } from './enrichment-dispatch.service'
import { CanonicalBookEnrichmentRepository } from '../repositories/canonical-book-enrichment.repository'
import type { DbService } from './db.service'
import type { DatabaseError } from '../repositories/book.repository'

export interface EnrichmentReconciliationServiceInterface {
  reconcile: (limit?: number) => Effect.Effect<{ dispatched: number }, DatabaseError, DbService | BookEnrichmentRepository | EnrichmentDispatchService>
}
export class EnrichmentReconciliationService extends Context.Tag('EnrichmentReconciliationService')<EnrichmentReconciliationService, EnrichmentReconciliationServiceInterface>() {}

export const EnrichmentReconciliationServiceLive = Layer.effect(EnrichmentReconciliationService, Effect.gen(function* () {
  const repo = yield* BookEnrichmentRepository
  const dispatch = yield* EnrichmentDispatchService
  const canonical = yield* CanonicalBookEnrichmentRepository
  return {
    reconcile: (limit = 100) => Effect.gen(function* () {
      yield* repo.cancelIneligibleJobs(new Date())
      const jobs = yield* repo.listRecoverableDispatch(new Date(), limit)
      const canonicalJobs = yield* canonical.listRecoverable(new Date(), limit)
      const importedResults = yield* Effect.forEach(jobs, job => dispatch.dispatch({ kind: 'imported', jobId: job.id, attempt: job.attempts + 1, batchId: job.batchId, userId: job.userId, isbn: job.isbn }))
      const canonicalResults = yield* Effect.forEach(canonicalJobs, job => dispatch.dispatch({ kind: 'canonical', jobId: job.bookId, attempt: job.attempts + 1, isbn: job.isbn }))
      return { dispatched: [...importedResults, ...canonicalResults].filter(Boolean).length }
    })
  }
}))
