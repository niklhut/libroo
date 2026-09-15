import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const [webConfigPath, outputPath] = process.argv.slice(2)
const workerName = process.env.ENRICHMENT_WORKER_NAME
const queueName = process.env.ENRICHMENT_QUEUE_NAME

if (!webConfigPath || !outputPath || !workerName || !queueName) {
  throw new Error('Usage: node scripts/cloudflare/generate-enrichment-wrangler-config.mjs <web-wrangler-config> <output-config> (ENRICHMENT_WORKER_NAME and ENRICHMENT_QUEUE_NAME required)')
}
if (!/^libroo-enrichment-(?:production|pr-\d+)$/.test(workerName)) {
  throw new Error(`Unsafe enrichment Worker name: ${workerName}`)
}
if (!/^libroo-enrichment-(?:production|pr-\d+)$/.test(queueName)) {
  throw new Error(`Unsafe enrichment Queue name: ${queueName}`)
}
if (queueName !== workerName) throw new Error('Enrichment Worker and Queue names must match exactly')

const web = JSON.parse(await readFile(webConfigPath, 'utf8'))
const expectedWebName = workerName === 'libroo-enrichment-production'
  ? 'libroo-production'
  : `libroo-pr-${workerName.match(/-pr-(\d+)$/)?.[1]}`
if (web.name !== expectedWebName) throw new Error(`Web Worker ${web.name} does not match enrichment environment ${workerName}`)
const db = web.d1_databases?.find(binding => binding.binding === 'DB')
const blob = web.r2_buckets?.find(binding => binding.binding === 'BLOB')
if (!db?.database_id || !blob?.bucket_name) {
  throw new Error('Web Wrangler config must contain DB and BLOB bindings before generating enrichment config')
}
if (workerName.endsWith('production') && (db.database_name?.includes('preview') || blob.bucket_name.includes('preview'))) {
  throw new Error('Production enrichment Worker cannot use preview D1 or R2 resources')
}
if (workerName.includes('-pr-')) {
  const suffix = workerName.match(/-pr-(\d+)$/)?.[1]
  if (suffix && (!queueName.endsWith(`-pr-${suffix}`) || !db.database_name?.endsWith(`-pr-${suffix}`) || !blob.bucket_name.endsWith(`-pr-${suffix}`))) {
    throw new Error('Preview enrichment Worker D1/R2 resources must use the same PR suffix')
  }
}
const producer = web.queues?.producers?.find(binding => binding.binding === 'ENRICHMENT_QUEUE')
if (!producer || producer.queue !== queueName) throw new Error('Web Worker ENRICHMENT_QUEUE producer does not match enrichment Queue')

const config = {
  name: workerName,
  main: resolve('workers/enrichment/index.ts'),
  compatibility_date: web.compatibility_date ?? '2025-01-15',
  workers_dev: false,
  compatibility_flags: ['nodejs_compat'],
  d1_databases: [{ binding: 'DB', database_name: db.database_name ?? db.name, database_id: db.database_id }],
  r2_buckets: [{ binding: 'BLOB', bucket_name: blob.bucket_name }],
  queues: { consumers: [{ queue: queueName, max_batch_size: 1 }] },
  workflows: [{ name: workerName, binding: 'ENRICHMENT_WORKFLOW', class_name: 'BookEnrichmentWorkflow' }],
  vars: {
    NUXT_OPEN_LIBRARY_REQUEST_TIMEOUT_SECONDS: process.env.NUXT_OPEN_LIBRARY_REQUEST_TIMEOUT_SECONDS || '12',
    NUXT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS: process.env.NUXT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS || '20'
  },
  observability: { enabled: true, logs: { enabled: true } },
  upload_source_maps: true,
  alias: {
    'hub:db:schema': resolve('server/db/schema/index.ts'),
    '#imports': resolve('workers/enrichment/runtime-config.ts'),
    '../runtime/profile.active': resolve('server/runtime/profile.cloudflare.ts')
  }
}

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`)
