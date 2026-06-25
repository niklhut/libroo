import { readFile } from 'node:fs/promises'

const configPath = process.argv[2]
const d1InventoryPath = process.argv[3]

if (!configPath || !d1InventoryPath) {
  throw new Error(
    'Usage: node scripts/preview/validate-wrangler-config.mjs <wrangler-config> <d1-inventory>'
  )
}

const requiredEnv = [
  'NUXT_CLOUDFLARE_WORKER_NAME',
  'NUXT_HUB_CLOUDFLARE_DATABASE_ID',
  'NUXT_HUB_CLOUDFLARE_BUCKET_NAME',
  'PREVIEW_D1_DATABASE_NAME'
]
const missingEnv = requiredEnv.filter(name => !process.env[name])
if (missingEnv.length > 0) {
  throw new Error(`Missing preview validation values: ${missingEnv.join(', ')}`)
}

const config = JSON.parse(await readFile(configPath, 'utf8'))
const d1Inventory = JSON.parse(await readFile(d1InventoryPath, 'utf8'))
const expectedWorkerName = process.env.NUXT_CLOUDFLARE_WORKER_NAME
const expectedDatabaseId = process.env.NUXT_HUB_CLOUDFLARE_DATABASE_ID
const expectedDatabaseName = process.env.PREVIEW_D1_DATABASE_NAME
const expectedBucketName = process.env.NUXT_HUB_CLOUDFLARE_BUCKET_NAME
const previewNamePattern = /^libroo-preview-pr-\d+$/
const workerNamePattern = /^libroo-pr-\d+$/

const errors = []

if (!workerNamePattern.test(expectedWorkerName)) {
  errors.push(`Worker name is not a preview name: ${expectedWorkerName}`)
}
if (!previewNamePattern.test(expectedDatabaseName)) {
  errors.push(`D1 name is not a preview name: ${expectedDatabaseName}`)
}
if (!previewNamePattern.test(expectedBucketName)) {
  errors.push(`R2 name is not a preview name: ${expectedBucketName}`)
}
if (expectedDatabaseName !== expectedBucketName) {
  errors.push('D1 and R2 preview resource names do not use the same PR suffix')
}
if (process.env.NUXT_CLOUDFLARE_CUSTOM_DOMAIN) {
  errors.push('NUXT_CLOUDFLARE_CUSTOM_DOMAIN must be unset')
}
if (config.name !== expectedWorkerName) {
  errors.push(`Worker config targets ${config.name}, expected ${expectedWorkerName}`)
}
if (config.workers_dev !== true) {
  errors.push('Preview Worker must have workers_dev enabled')
}
if (config.routes?.length) {
  errors.push('Preview Worker must not contain custom routes')
}
if (config.triggers) {
  errors.push('Preview Worker must not contain scheduled triggers')
}

const d1Bindings = config.d1_databases ?? []
const dbBinding = d1Bindings.find(binding => binding.binding === 'DB')
if (d1Bindings.length !== 1 || !dbBinding) {
  errors.push('Preview config must contain exactly one D1 binding named DB')
} else if (dbBinding.database_id !== expectedDatabaseId) {
  errors.push(
    `DB binding targets ${dbBinding.database_id}, expected ${expectedDatabaseId}`
  )
}

const provisionedDatabase = d1Inventory.find(
  database => database.name === expectedDatabaseName
)
if (!provisionedDatabase) {
  errors.push(`Cloudflare D1 inventory does not contain ${expectedDatabaseName}`)
} else if (provisionedDatabase.uuid !== expectedDatabaseId) {
  errors.push(
    `${expectedDatabaseName} has UUID ${provisionedDatabase.uuid}, expected ${expectedDatabaseId}`
  )
}

const r2Bindings = config.r2_buckets ?? []
const blobBinding = r2Bindings.find(binding => binding.binding === 'BLOB')
if (r2Bindings.length !== 1 || !blobBinding) {
  errors.push('Preview config must contain exactly one R2 binding named BLOB')
} else if (blobBinding.bucket_name !== expectedBucketName) {
  errors.push(
    `BLOB binding targets ${blobBinding.bucket_name}, expected ${expectedBucketName}`
  )
}

if (errors.length > 0) {
  console.error('Refusing to migrate or deploy an unsafe preview configuration:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Preview Wrangler configuration is isolated and safe:')
console.log(`- Worker: ${expectedWorkerName}`)
console.log(`- DB binding: ${expectedDatabaseName} (${expectedDatabaseId})`)
console.log(`- BLOB binding: ${expectedBucketName}`)
