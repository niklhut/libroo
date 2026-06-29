#!/usr/bin/env node
import { writeFile } from 'node:fs/promises'
import { buildBackupManifest } from './lib/backup-metadata.mjs'

function requireValue(argv, index, flag) {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`)
  }
  return value
}

function parseArgs(argv) {
  const options = {
    output: 'manifest.json',
    runtimeProfile: process.env.NUXT_LIBROO_RUNTIME_PROFILE || 'cloudflare',
    worker: process.env.NUXT_CLOUDFLARE_WORKER_NAME || null,
    d1Database: process.env.NUXT_HUB_CLOUDFLARE_DATABASE_ID || null,
    r2Bucket: process.env.NUXT_HUB_CLOUDFLARE_BUCKET_NAME || null
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--output') {
      options.output = requireValue(argv, index, '--output')
      index += 1
    } else if (arg === '--worker') {
      options.worker = requireValue(argv, index, '--worker')
      index += 1
    } else if (arg === '--d1-database') {
      options.d1Database = requireValue(argv, index, '--d1-database')
      index += 1
    } else if (arg === '--r2-bucket') {
      options.r2Bucket = requireValue(argv, index, '--r2-bucket')
      index += 1
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage: node scripts/hosted-backup-manifest.mjs [--output manifest.json] [--worker name] [--d1-database id-or-name] [--r2-bucket name]

This helper records app and code migration metadata for a hosted D1/R2 backup.
It does not inspect Cloudflare migration state; keep the wrangler export and
rclone copy logs next to the emitted manifest.`)
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  printHelp()
  process.exit(0)
}

const now = new Date()
const manifest = await buildBackupManifest({
  runtimeProfile: options.runtimeProfile,
  createdAt: now,
  databaseSnapshotAt: now,
  completedAt: new Date(),
  extraRuntime: {
    worker: options.worker,
    d1Database: options.d1Database,
    r2Bucket: options.r2Bucket,
    database: 'cloudflare-d1',
    blobStorage: 'cloudflare-r2'
  },
  appliedMigrationState: {
    status: 'unavailable',
    source: 'cloudflare-d1',
    reason: 'Hosted manifest helper cannot inspect the remote D1 __drizzle_migrations table; keep Wrangler export and migration logs with this manifest.'
  }
})

await writeFile(options.output, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Hosted backup manifest written: ${options.output}`)
