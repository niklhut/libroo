import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const MANIFEST_FORMAT_VERSION = 1
export const MANIFEST_FILENAME = 'manifest.json'
export const DEFAULT_MIGRATION_JOURNAL_PATH = 'server/db/migrations/sqlite/meta/_journal.json'

export function createEmptyManifestShape() {
  return {
    manifestFormatVersion: MANIFEST_FORMAT_VERSION,
    app: {
      version: ''
    },
    runtime: {
      profile: '',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    },
    timestamps: {
      createdAt: '',
      databaseSnapshotAt: '',
      completedAt: ''
    },
    migrations: {
      latest: {
        tag: null,
        idx: null
      },
      applied: [],
      appliedState: {
        status: 'inspected',
        source: '__drizzle_migrations',
        reason: null
      }
    }
  }
}

export async function readPackageVersion(packageJsonPath = 'package.json') {
  const raw = await readFile(resolve(packageJsonPath), 'utf8')
  const parsed = JSON.parse(raw)
  if (!parsed.version || typeof parsed.version !== 'string') {
    throw new Error(`${packageJsonPath} must define a string "version" field`)
  }
  return parsed.version
}

export async function readLatestMigration(journalPath = DEFAULT_MIGRATION_JOURNAL_PATH) {
  const raw = await readFile(resolve(journalPath), 'utf8')
  const journal = JSON.parse(raw)
  const entries = Array.isArray(journal.entries) ? journal.entries : []
  const latest = entries.at(-1)

  return {
    tag: latest?.tag ?? null,
    idx: Number.isInteger(latest?.idx) ? latest.idx : null
  }
}

export async function readAppliedMigrations(client) {
  try {
    const result = await client.execute('select id, hash, created_at from __drizzle_migrations order by id')
    return result.rows.map(row => ({
      id: normalizeNumber(row.id),
      hash: row.hash == null ? null : String(row.hash),
      createdAt: normalizeNumber(row.created_at)
    }))
  } catch (error) {
    if (isMissingTableError(error)) {
      return []
    }
    throw error
  }
}

export async function buildBackupManifest({
  client,
  runtimeProfile,
  createdAt = new Date(),
  databaseSnapshotAt = createdAt,
  completedAt = new Date(),
  packageJsonPath,
  migrationJournalPath,
  extraRuntime = {},
  appliedMigrationState
}) {
  if (!client && appliedMigrationState?.status !== 'unavailable') {
    throw new Error('buildBackupManifest requires a libSQL client')
  }

  const manifest = createEmptyManifestShape()
  manifest.app.version = await readPackageVersion(packageJsonPath)
  manifest.runtime = {
    ...manifest.runtime,
    profile: runtimeProfile,
    ...extraRuntime
  }
  manifest.timestamps = {
    createdAt: toIsoString(createdAt),
    databaseSnapshotAt: toIsoString(databaseSnapshotAt),
    completedAt: toIsoString(completedAt)
  }
  manifest.migrations = {
    latest: await readLatestMigration(migrationJournalPath),
    applied: client ? await readAppliedMigrations(client) : [],
    appliedState: appliedMigrationState ?? {
      status: 'inspected',
      source: '__drizzle_migrations',
      reason: null
    }
  }

  return manifest
}

export function assertManifestShape(manifest) {
  const expected = createEmptyManifestShape()
  const missing = [
    ['manifestFormatVersion', manifest?.manifestFormatVersion],
    ['app.version', manifest?.app?.version],
    ['runtime.profile', manifest?.runtime?.profile],
    ['timestamps.createdAt', manifest?.timestamps?.createdAt],
    ['timestamps.databaseSnapshotAt', manifest?.timestamps?.databaseSnapshotAt],
    ['timestamps.completedAt', manifest?.timestamps?.completedAt],
    ['migrations.latest', manifest?.migrations?.latest],
    ['migrations.applied', manifest?.migrations?.applied],
    ['migrations.appliedState.status', manifest?.migrations?.appliedState?.status]
  ].filter(([, value]) => value == null || (typeof value === 'string' && value.trim() === ''))

  if (missing.length > 0) {
    throw new Error(`Backup manifest is missing required field(s): ${missing.map(([name]) => name).join(', ')}`)
  }

  if (manifest.manifestFormatVersion !== expected.manifestFormatVersion) {
    throw new Error(`Unsupported backup manifest format ${manifest.manifestFormatVersion}; expected ${expected.manifestFormatVersion}`)
  }

  if (!Array.isArray(manifest.migrations.applied)) {
    throw new Error('Backup manifest migrations.applied must be an array')
  }

  if (!['inspected', 'unavailable'].includes(manifest.migrations.appliedState.status)) {
    throw new Error('Backup manifest migrations.appliedState.status must be inspected or unavailable')
  }

  for (const value of [
    manifest.timestamps.createdAt,
    manifest.timestamps.databaseSnapshotAt,
    manifest.timestamps.completedAt
  ]) {
    if (Number.isNaN(Date.parse(value))) {
      throw new Error('Backup manifest timestamps must be valid ISO-8601 strings')
    }
  }
}

function normalizeNumber(value) {
  if (value == null) {
    return null
  }
  const numberValue = Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function isMissingTableError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('__drizzle_migrations') && /no such table/i.test(message)
}

function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}
