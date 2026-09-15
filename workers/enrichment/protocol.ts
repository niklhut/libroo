export type EnrichmentKind = 'imported' | 'canonical'

export interface EnrichmentQueueMessage {
  kind: EnrichmentKind
  jobId: string
  attempt: number
}

export function parseEnrichmentMessage(value: unknown): EnrichmentQueueMessage | null {
  if (!value || typeof value !== 'object') return null
  const message = value as Record<string, unknown>
  if ((message.kind !== 'imported' && message.kind !== 'canonical') || typeof message.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(message.jobId) || !Number.isInteger(message.attempt) || (message.attempt as number) < 1) return null
  return { kind: message.kind, jobId: message.jobId, attempt: message.attempt as number }
}

export function workflowId(message: EnrichmentQueueMessage) {
  return `${message.kind}-${message.jobId}-${message.attempt}`
}
