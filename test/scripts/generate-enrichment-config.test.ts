import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fixturesDir, runScript, scriptPath } from './helpers'

describe('enrichment Wrangler config generation', () => {
  async function runWithWebMutation(mutate: (web: Record<string, unknown>) => void, env = {}) {
    const directory = await mkdtemp(join(tmpdir(), 'libroo-enrichment-config-'))
    const output = join(directory, 'wrangler.json')
    const webConfig = join(directory, 'web-wrangler.json')
    const fixture = JSON.parse(await readFile(join(fixturesDir, 'wrangler-preview-valid.json'), 'utf8'))
    fixture.queues = { producers: [{ binding: 'ENRICHMENT_QUEUE', queue: 'libroo-enrichment-pr-42' }] }
    if (typeof mutate === 'function') mutate(fixture)
    await writeFile(webConfig, JSON.stringify(fixture))
    const result = runScript(scriptPath('scripts/cloudflare/generate-enrichment-wrangler-config.mjs'), [webConfig, output], {
      env: { ENRICHMENT_WORKER_NAME: 'libroo-enrichment-pr-42', ENRICHMENT_QUEUE_NAME: 'libroo-enrichment-pr-42', ...env }
    })
    await rm(directory, { recursive: true, force: true })
    return result
  }

  it('carries only the validated web D1/R2 identities into an isolated worker', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'libroo-enrichment-config-'))
    const output = join(directory, 'wrangler.json')
    const webConfig = join(directory, 'web-wrangler.json')
    try {
      const fixture = JSON.parse(await readFile(join(fixturesDir, 'wrangler-preview-valid.json'), 'utf8'))
      fixture.queues = { producers: [{ binding: 'ENRICHMENT_QUEUE', queue: 'libroo-enrichment-pr-42' }] }
      await writeFile(webConfig, JSON.stringify(fixture))
      const result = runScript(scriptPath('scripts/cloudflare/generate-enrichment-wrangler-config.mjs'), [
        webConfig, output
      ], {
        env: {
          ENRICHMENT_WORKER_NAME: 'libroo-enrichment-pr-42',
          ENRICHMENT_QUEUE_NAME: 'libroo-enrichment-pr-42'
        }
      })
      expect(result.status).toBe(0)
      const config = JSON.parse(await readFile(output, 'utf8'))
      expect(config.name).toBe('libroo-enrichment-pr-42')
      expect(config.d1_databases[0]).toMatchObject({ binding: 'DB', database_id: 'preview-db-uuid-123' })
      expect(config.r2_buckets[0]).toMatchObject({ binding: 'BLOB', bucket_name: 'libroo-preview-pr-42' })
      expect(config.queues.consumers[0].queue).toBe('libroo-enrichment-pr-42')
      expect(config.workflows[0]).toMatchObject({ binding: 'ENRICHMENT_WORKFLOW', class_name: 'BookEnrichmentWorkflow' })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['mismatched Queue PR suffix', {}, { ENRICHMENT_QUEUE_NAME: 'libroo-enrichment-pr-43' }],
    ['mismatched web Worker name', (web) => { web.name = 'libroo-pr-43' }, {}],
    ['missing producer binding', (web) => { web.queues = undefined }, {}],
    ['wrong producer binding', (web) => { (web.queues as { producers: Array<{ queue: string }> }).producers[0]!.queue = 'libroo-enrichment-pr-43' }, {}]
  ])('rejects %s', async (_name, mutate, env) => {
    const result = await runWithWebMutation(mutate as (web: Record<string, unknown>) => void, env as Record<string, string>)
    expect(result.status).not.toBe(0)
  })
})
