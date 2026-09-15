import { describe, expect, it, vi } from 'vitest'
import { handleEnrichmentQueue } from '../../workers/enrichment/queue'
import { parseEnrichmentMessage, workflowId } from '../../workers/enrichment/protocol'

function entry(body: unknown) {
  return { body, ack: vi.fn(), retry: vi.fn() }
}

describe('Cloudflare enrichment worker boundary', () => {
  it('accepts only the stable per-job protocol and derives an attempt-fenced workflow id', () => {
    expect(parseEnrichmentMessage({ kind: 'imported', jobId: 'job-1', attempt: 2 })).toEqual({ kind: 'imported', jobId: 'job-1', attempt: 2 })
    expect(workflowId({ kind: 'canonical', jobId: 'book-1', attempt: 3 })).toBe('canonical-book-1-3')
    expect(parseEnrichmentMessage({ kind: 'imported', jobId: 'job-1', attempt: 0 })).toBeNull()
    expect(parseEnrichmentMessage({ kind: 'other', jobId: 'job-1', attempt: 1 })).toBeNull()
  })

  it('coalesces duplicate deliveries into one idempotent workflow instance', async () => {
    const first = entry({ kind: 'imported', jobId: 'job-1', attempt: 1 })
    const duplicate = entry({ kind: 'imported', jobId: 'job-1', attempt: 1 })
    const other = entry({ kind: 'canonical', jobId: 'book-1', attempt: 1 })
    const createBatch = vi.fn().mockResolvedValue([{ id: 'imported-job-1-1' }, { id: 'canonical-book-1-1' }])
    await handleEnrichmentQueue({ messages: [first, duplicate, other] }, { ENRICHMENT_WORKFLOW: { createBatch, get: vi.fn() } })
    expect(createBatch).toHaveBeenCalledOnce()
    expect(createBatch.mock.calls[0]?.[0]).toEqual([
      { id: 'imported-job-1-1', params: { kind: 'imported', jobId: 'job-1', attempt: 1 } },
      { id: 'canonical-book-1-1', params: { kind: 'canonical', jobId: 'book-1', attempt: 1 } }
    ])
    expect(first.ack).toHaveBeenCalledOnce()
    expect(duplicate.ack).toHaveBeenCalledOnce()
    expect(other.ack).toHaveBeenCalledOnce()
  })

  it('retries every valid message when workflow creation fails and acks malformed messages', async () => {
    const valid = entry({ kind: 'imported', jobId: 'job-1', attempt: 1 })
    const malformed = entry({ kind: 'imported', jobId: 'job-1', attempt: 0 })
    await handleEnrichmentQueue({ messages: [valid, malformed] }, { ENRICHMENT_WORKFLOW: { createBatch: vi.fn().mockRejectedValue(new Error('unavailable')), get: vi.fn() } })
    expect(valid.retry).toHaveBeenCalledOnce()
    expect(valid.ack).not.toHaveBeenCalled()
    expect(malformed.ack).toHaveBeenCalledOnce()
  })

  it('restarts an errored instance and acknowledges it', async () => {
    const item = entry({ kind: 'imported', jobId: 'job-2', attempt: 1 })
    const restart = vi.fn().mockResolvedValue(undefined)
    const createBatch = vi.fn()
    await handleEnrichmentQueue({ messages: [item] }, { ENRICHMENT_WORKFLOW: { createBatch: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({ status: vi.fn().mockResolvedValue({ status: 'errored' }), restart }) } })
    expect(createBatch).not.toHaveBeenCalled()
    expect(restart).toHaveBeenCalledOnce()
    expect(item.ack).toHaveBeenCalledOnce()
  })

  it('leaves running duplicates alone', async () => {
    const item = entry({ kind: 'imported', jobId: 'job-3', attempt: 1 })
    const restart = vi.fn()
    await handleEnrichmentQueue({ messages: [item] }, { ENRICHMENT_WORKFLOW: { createBatch: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({ status: vi.fn().mockResolvedValue({ status: 'running' }) }), restart } })
    expect(restart).not.toHaveBeenCalled()
    expect(item.ack).toHaveBeenCalledOnce()
  })

  it('retries when status lookup or restart fails', async () => {
    const statusFailure = entry({ kind: 'imported', jobId: 'job-4', attempt: 1 })
    await handleEnrichmentQueue({ messages: [statusFailure] }, { ENRICHMENT_WORKFLOW: { createBatch: vi.fn().mockResolvedValue([]), get: vi.fn().mockRejectedValue(new Error('unavailable')) } })
    expect(statusFailure.retry).toHaveBeenCalledOnce()
    const restartFailure = entry({ kind: 'imported', jobId: 'job-5', attempt: 1 })
    await handleEnrichmentQueue({ messages: [restartFailure] }, { ENRICHMENT_WORKFLOW: { createBatch: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({ status: vi.fn().mockResolvedValue({ status: 'errored' }) }), restart: vi.fn().mockRejectedValue(new Error('failed')) } })
    expect(restartFailure.retry).toHaveBeenCalledOnce()
  })
})
