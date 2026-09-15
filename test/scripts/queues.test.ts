import { describe, expect, it } from 'vitest'
import { listQueues } from '../../scripts/cloudflare/queues.mjs'

const response = (body: unknown, ok = true) => ({ ok, statusText: ok ? 'OK' : 'Bad Request', json: async () => body })

describe('Cloudflare Queue API helper', () => {
  it('lists every page', async () => {
    const calls: string[] = []
    const queues = await listQueues(async (url) => {
      calls.push(url)
      const page = new URL(url).searchParams.get('page')
      return response({ success: true, result: [{ queue_name: `queue-${page}` }], result_info: { total_pages: 2 } })
    }, 'account', 'token')
    expect(calls).toHaveLength(2)
    expect(queues.map(queue => queue.queue_name)).toEqual(['queue-1', 'queue-2'])
  })

  it('fails with the API error', async () => {
    await expect(listQueues(async () => response({ success: false, errors: [{ message: 'denied' }] }, false), 'account', 'token')).rejects.toThrow('denied')
  })
})
