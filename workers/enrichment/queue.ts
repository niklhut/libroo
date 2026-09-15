import { parseEnrichmentMessage, workflowId, type EnrichmentQueueMessage } from './protocol'

export interface EnrichmentWorkflowBinding {
  createBatch: (instances: Array<{ id: string, params: EnrichmentQueueMessage }>) => Promise<Array<{ id: string }>>
  get: (id: string) => Promise<{ status: () => Promise<{ status: string }>, restart: () => Promise<void> }>
}

export interface EnrichmentWorkerEnv {
  ENRICHMENT_WORKFLOW: EnrichmentWorkflowBinding
}

/** Queue entrypoint. Duplicate deliveries are collapsed before createBatch. */
export async function handleEnrichmentQueue(
  batch: { messages: Array<{ body: unknown, ack: () => void, retry: () => void }> },
  env: EnrichmentWorkerEnv
) {
  const valid = new Map<string, { message: EnrichmentQueueMessage, entries: Array<{ ack: () => void, retry: () => void }> }>()
  for (const entry of batch.messages) {
    const message = parseEnrichmentMessage(entry.body)
    if (!message) {
      entry.ack()
      continue
    }
    const id = workflowId(message)
    if (id.length > 100) {
      entry.ack()
      continue
    }
    const current = valid.get(id)
    if (current) current.entries.push(entry)
    else valid.set(id, { message, entries: [entry] })
  }
  if (valid.size === 0) return
  try {
    const instances = [...valid.values()].map(({ message }) => ({ id: workflowId(message), params: message }))
    const created = new Set((await env.ENRICHMENT_WORKFLOW.createBatch(instances)).map(instance => instance.id))
    for (const instance of instances) if (!created.has(instance.id)) {
      const existing = await env.ENRICHMENT_WORKFLOW.get(instance.id)
      const status = await existing.status()
      if (status.status === 'errored' || status.status === 'terminated') await existing.restart()
    }
    for (const { entries } of valid.values()) for (const entry of entries) entry.ack()
  } catch {
    for (const { entries } of valid.values()) for (const entry of entries) entry.retry()
  }
}

export default {
  async queue(batch: Parameters<typeof handleEnrichmentQueue>[0], env: EnrichmentWorkerEnv) {
    await handleEnrichmentQueue(batch, env)
  }
}
