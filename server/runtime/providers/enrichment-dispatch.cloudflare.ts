// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Type-only declaration for workerd's virtual module during Nuxt compilation.
/// <reference path="./cloudflare-workers.d.ts" />
import { Effect, Layer } from 'effect'
import { EnrichmentDispatchService, type EnrichmentDispatchMessage } from '../../services/enrichment-dispatch.service'

type QueueBinding = { send: (message: EnrichmentDispatchMessage) => Promise<void> }
type CloudflareEnv = { ENRICHMENT_QUEUE?: QueueBinding }

/** Queue binding is injected by the hosted request runtime. */
export const EnrichmentDispatchServiceCloudflareLive = Layer.succeed(EnrichmentDispatchService, {
  dispatch: (message: EnrichmentDispatchMessage) => Effect.tryPromise({
    try: async () => {
      const cloudflareWorkers = await import('cloudflare:workers') as unknown as { env: CloudflareEnv }
      const queue = cloudflareWorkers.env.ENRICHMENT_QUEUE
      if (!queue) throw new Error('ENRICHMENT_QUEUE binding is required for hosted enrichment dispatch')
      await queue.send(message)
    },
    catch: error => new Error(String(error))
  }).pipe(Effect.tapError(error => Effect.logError(error.message)), Effect.as(true), Effect.catchAll(() => Effect.succeed(false)))
})
