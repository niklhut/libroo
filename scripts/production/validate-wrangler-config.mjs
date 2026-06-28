import { readFile } from 'node:fs/promises'

const configPath = process.argv[2]
const errors = []

if (!configPath) {
  errors.push(
    'Usage: node scripts/production/validate-wrangler-config.mjs <wrangler-config>'
  )
}

const expectedDatabaseId = process.env.NUXT_HUB_CLOUDFLARE_DATABASE_ID
const expectedBucketName = process.env.NUXT_HUB_CLOUDFLARE_BUCKET_NAME
const rawCustomDomain = process.env.NUXT_CLOUDFLARE_CUSTOM_DOMAIN
const expectedCustomDomain = rawCustomDomain
  ? /^https?:\/\//.test(rawCustomDomain)
    ? new URL(rawCustomDomain).hostname
    : rawCustomDomain
  : undefined

if (!expectedDatabaseId) {
  errors.push('NUXT_HUB_CLOUDFLARE_DATABASE_ID must be set')
}
if (!expectedBucketName) {
  errors.push('NUXT_HUB_CLOUDFLARE_BUCKET_NAME must be set')
}
if (!expectedCustomDomain) {
  errors.push('NUXT_CLOUDFLARE_CUSTOM_DOMAIN must be set')
}

let config
if (configPath) {
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'))
  } catch (error) {
    errors.push(`Unable to read production Wrangler config: ${error.message}`)
  }
}

if (config) {
  if (config.name !== 'libroo-production') {
    errors.push(`Worker config targets ${config.name}, expected libroo-production`)
  }
  if (config.workers_dev !== undefined && config.workers_dev !== false) {
    errors.push('Production Worker must have workers_dev disabled or omitted')
  }

  const routes = config.routes ?? []
  const productionRoute = routes.find(route =>
    typeof route === 'object'
    && route.pattern === expectedCustomDomain
    && route.custom_domain === true
  )
  if (!productionRoute) {
    errors.push(
      `Production routes must contain ${expectedCustomDomain} with custom_domain enabled`
    )
  }

  const crons = config.triggers?.crons ?? []
  for (const cron of ['0 3 * * *', '30 3 * * *']) {
    if (!crons.includes(cron)) {
      errors.push(`Production cron triggers must contain ${cron}`)
    }
  }

  const d1Bindings = config.d1_databases ?? []
  const dbBinding = d1Bindings.find(binding => binding.binding === 'DB')
  if (d1Bindings.length !== 1 || !dbBinding) {
    errors.push('Production config must contain exactly one D1 binding named DB')
  } else if (dbBinding.database_id !== expectedDatabaseId) {
    errors.push(
      `DB binding targets ${dbBinding.database_id}, expected ${expectedDatabaseId}`
    )
  }

  const r2Bindings = config.r2_buckets ?? []
  const blobBinding = r2Bindings.find(binding => binding.binding === 'BLOB')
  if (r2Bindings.length !== 1 || !blobBinding) {
    errors.push('Production config must contain exactly one R2 binding named BLOB')
  } else if (blobBinding.bucket_name !== expectedBucketName) {
    errors.push(
      `BLOB binding targets ${blobBinding.bucket_name}, expected ${expectedBucketName}`
    )
  }

  if (
    config.vars?.NUXT_CLOUDFLARE_PREVIEW !== undefined
    && config.vars.NUXT_CLOUDFLARE_PREVIEW !== 'false'
  ) {
    errors.push('Production runtime preview enforcement must be absent or "false"')
  }
  if (config.vars?.NUXT_LIBROO_RUNTIME_PROFILE !== 'cloudflare') {
    errors.push('Production Worker runtime profile must be cloudflare')
  }

  const previewWorkerPattern = /^libroo-pr-\d+$/
  const previewResourcePattern = /^libroo-preview-pr-\d+$/
  const d1Name = dbBinding?.database_name ?? dbBinding?.name
  if (previewWorkerPattern.test(config.name)) {
    errors.push(`Worker name matches a preview pattern: ${config.name}`)
  }
  if (d1Name && previewResourcePattern.test(d1Name)) {
    errors.push(`D1 name matches a preview pattern: ${d1Name}`)
  }
  if (blobBinding?.bucket_name && previewResourcePattern.test(blobBinding.bucket_name)) {
    errors.push(`R2 name matches a preview pattern: ${blobBinding.bucket_name}`)
  }
}

if (errors.length > 0) {
  console.error('Refusing to migrate or deploy an unsafe production configuration:')
  for (const error of errors) {
    console.error(`- ${error}`)
  }
  process.exit(1)
}

console.log('Production Wrangler configuration is safe:')
console.log('- Worker: libroo-production')
console.log(`- Custom domain: ${expectedCustomDomain}`)
console.log(`- DB binding: ${expectedDatabaseId}`)
console.log(`- BLOB binding: ${expectedBucketName}`)
