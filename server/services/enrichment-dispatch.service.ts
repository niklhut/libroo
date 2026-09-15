import { Context, Effect, Layer } from 'effect'

export interface EnrichmentDispatchMessage {
  kind: 'imported' | 'canonical'
  jobId: string
  attempt: number
  batchId?: string
  userId?: string
  isbn: string
}

export interface EnrichmentDispatchServiceInterface {
  dispatch: (message: EnrichmentDispatchMessage) => Effect.Effect<boolean>
}

export class EnrichmentDispatchService extends Context.Tag('EnrichmentDispatchService')<
  EnrichmentDispatchService,
  EnrichmentDispatchServiceInterface
>() {}

/** Self-hosted installations retain scheduled reconciliation and need no queue. */
export const EnrichmentDispatchServiceLive = Layer.succeed(EnrichmentDispatchService, {
  dispatch: () => Effect.succeed(true)
})
