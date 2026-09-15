import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { claimEnrichmentJob, lookupEnrichmentMetadata, storeEnrichmentCover, persistEnrichmentMetadata, addEnrichmentTags, completeEnrichmentJob, failEnrichmentJob, releaseEnrichmentClaimLock, type WorkerEnv } from './service'
import { workflowId, type EnrichmentQueueMessage } from './protocol'

const options = { retries: { limit: 0, delay: '1 second' } } as const

export class BookEnrichmentWorkflow extends WorkflowEntrypoint<WorkerEnv, EnrichmentQueueMessage> {
  async run(event: WorkflowEvent<EnrichmentQueueMessage>, step: WorkflowStep) {
    const id = workflowId(event.payload)
    const durable = <T extends Rpc.Serializable<T>>(stage: string, callback: () => Promise<T>): Promise<T> => step.do(`${id}-${stage}`, options, async (_context) => {
      const startedAt = Date.now()
      console.info(JSON.stringify({ stage, jobId: event.payload.jobId, kind: event.payload.kind, attempt: event.payload.attempt, outcome: 'started' }))
      try {
        const result = await callback()
        console.info(JSON.stringify({ stage, jobId: event.payload.jobId, kind: event.payload.kind, attempt: event.payload.attempt, outcome: 'completed', durationMs: Date.now() - startedAt }))
        return result
      } catch (error) {
        console.info(JSON.stringify({ stage, jobId: event.payload.jobId, kind: event.payload.kind, attempt: event.payload.attempt, outcome: 'failed', durationMs: Date.now() - startedAt, error: String(error) }))
        throw error
      }
    })
    const claim = await durable('claim', () => claimEnrichmentJob(event.payload, this.env))
    if (!claim) return { skipped: true }
    try {
      const data = await durable('metadata', () => lookupEnrichmentMetadata(claim, this.env))
      if (!data) {
        await durable('complete-not-found', () => completeEnrichmentJob(claim, 'not_found', this.env))
        return { status: 'not_found' }
      }
      const cover = await durable('cover', () => storeEnrichmentCover(claim, data, this.env))
      if (data.coverUrl && !cover && claim.job.attempts < claim.job.maxAttempts) {
        await durable('retry-cover', () => failEnrichmentJob(claim, 'Open Library advertised a cover but it could not be stored', this.env))
        return { status: 'retrying' }
      }
      const persisted = await durable('persist', () => persistEnrichmentMetadata(claim, data, cover, this.env))
      if (persisted === false) return { status: 'cancelled' }
      await durable('tags', () => addEnrichmentTags(claim, data, this.env))
      await durable('complete', () => completeEnrichmentJob(claim, cover ? 'completed' : 'no_cover', this.env))
      return { status: cover ? 'completed' : 'no_cover' }
    } catch (error) {
      await durable('failure', () => failEnrichmentJob(claim, String(error), this.env))
      throw error
    } finally {
      await durable('release', () => releaseEnrichmentClaimLock(claim, this.env))
    }
  }
}
