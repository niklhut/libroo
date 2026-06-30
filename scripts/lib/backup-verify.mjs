import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { createClient } from '@libsql/client/node'
import {
  assertManifestShape,
  readLatestMigration,
  readPackageVersion
} from './backup-metadata.mjs'

const CORE_TABLES = [
  'user',
  'account',
  'session',
  'books',
  'authors',
  'book_authors',
  'locations',
  'user_books',
  'tags',
  'book_system_tags',
  'user_book_tags',
  'loans',
  'signup_invites',
  'admin_audit_log'
]

export async function verifyBackupTarget({
  databaseUrl,
  blobDir,
  manifestPath,
  manifest,
  packageJsonPath,
  migrationJournalPath,
  currentRuntimeProfile = process.env.NUXT_LIBROO_RUNTIME_PROFILE || 'selfhost'
}) {
  const resolvedBlobDir = resolve(blobDir)
  const result = {
    ok: false,
    errors: [],
    warnings: [],
    rowCounts: {},
    coverReferences: {
      checked: [],
      broken: [],
      orphanedBlobs: []
    },
    manifest: null
  }

  let loadedManifest
  try {
    loadedManifest = manifest ?? await readManifest(manifestPath)
    assertManifestShape(loadedManifest)
    result.manifest = loadedManifest
  } catch (error) {
    result.errors.push(`Manifest verification failed: ${formatError(error)}`)
    return result
  }

  const client = createClient({ url: databaseUrl })

  try {
    await client.execute('select 1')
  } catch (error) {
    result.errors.push(`Database health probe failed: ${formatError(error)}`)
  }

  for (const table of CORE_TABLES) {
    try {
      const countResult = await client.execute(`select count(*) as count from ${quoteIdentifier(table)}`)
      result.rowCounts[table] = Number(countResult.rows[0]?.count ?? 0)
    } catch (error) {
      result.errors.push(`Could not count table ${table}: ${formatError(error)}`)
    }
  }

  try {
    const references = await readCoverReferences(client)
    const blobFiles = await listBlobFiles(resolvedBlobDir)
    const blobSet = new Set(blobFiles)
    const referenceSet = new Set(references.map(reference => reference.path))

    result.coverReferences.checked = references
    result.coverReferences.broken = references
      .filter(reference => !blobSet.has(reference.path))
      .map(reference => ({
        ...reference,
        expectedPath: join(resolvedBlobDir, reference.path)
      }))
    result.coverReferences.orphanedBlobs = blobFiles
      .filter(pathname => !referenceSet.has(pathname))
      .sort()

    if (result.coverReferences.broken.length > 0) {
      result.errors.push(`Missing ${result.coverReferences.broken.length} referenced cover blob(s).`)
    }
    if (result.coverReferences.orphanedBlobs.length > 0) {
      result.warnings.push(`Found ${result.coverReferences.orphanedBlobs.length} orphaned blob(s).`)
    }
  } catch (error) {
    result.errors.push(`Cover-reference verification failed: ${formatError(error)}`)
  }

  try {
    const currentLatestMigration = await readLatestMigration(migrationJournalPath)
    const currentVersion = await readPackageVersion(packageJsonPath)
    const compatibility = checkManifestCompatibility(loadedManifest, {
      currentLatestMigration,
      currentVersion,
      currentRuntimeProfile
    })
    result.errors.push(...compatibility.errors)
    result.warnings.push(...compatibility.warnings)
  } catch (error) {
    result.errors.push(`Manifest compatibility check failed: ${formatError(error)}`)
  } finally {
    client.close()
  }

  result.ok = result.errors.length === 0
  return result
}

export function checkManifestCompatibility(manifest, { currentLatestMigration, currentVersion, currentRuntimeProfile }) {
  const errors = []
  const warnings = []
  const backupMigration = manifest.migrations.latest
  const backupVersion = manifest.app.version
  const backupRuntimeProfile = manifest.runtime.profile

  if (currentRuntimeProfile && backupRuntimeProfile !== currentRuntimeProfile) {
    errors.push(`Backup runtime profile ${backupRuntimeProfile} does not match current runtime profile ${currentRuntimeProfile}.`)
  }

  if (backupMigration.idx != null && currentLatestMigration.idx != null) {
    if (backupMigration.idx > currentLatestMigration.idx) {
      errors.push(`Backup migration ${backupMigration.tag} (idx ${backupMigration.idx}) is ahead of this codebase (${currentLatestMigration.tag}, idx ${currentLatestMigration.idx}). Forward-only restore is not supported.`)
    } else if (backupMigration.idx < currentLatestMigration.idx) {
      warnings.push(`Backup migration ${backupMigration.tag} (idx ${backupMigration.idx}) is behind this codebase (${currentLatestMigration.tag}, idx ${currentLatestMigration.idx}); restore will apply pending migrations.`)
    } else if (backupMigration.tag !== currentLatestMigration.tag) {
      errors.push(`Backup migration idx ${backupMigration.idx} tag ${backupMigration.tag} does not match current tag ${currentLatestMigration.tag}.`)
    }
  } else {
    warnings.push('Could not compare migration idx values; inspect manifest and code migration journal manually.')
  }

  const versionComparison = compareSemverish(backupVersion, currentVersion)
  if (versionComparison == null) {
    if (backupVersion !== currentVersion) {
      warnings.push(`Backup app version ${backupVersion} differs from current app version ${currentVersion}.`)
    }
  } else if (versionComparison > 0) {
    errors.push(`Backup app version ${backupVersion} is ahead of this codebase (${currentVersion}). Forward-only restore is not supported.`)
  } else if (versionComparison < 0) {
    warnings.push(`Backup app version ${backupVersion} is behind this codebase (${currentVersion}); verify release notes before restoring.`)
  }

  return { errors, warnings }
}

export function formatVerificationReport(result) {
  const lines = []
  lines.push(result.ok ? 'Backup verification passed.' : 'Backup verification failed.')
  lines.push(`Core row counts: ${Object.entries(result.rowCounts).map(([table, count]) => `${table}=${count}`).join(', ') || 'none'}`)
  lines.push(`Cover references checked: ${result.coverReferences.checked.length}`)

  if (result.coverReferences.broken.length > 0) {
    lines.push('Broken cover references:')
    for (const broken of result.coverReferences.broken) {
      lines.push(`- ${broken.source}.${broken.column} row ${broken.id}: ${broken.path}`)
    }
  }

  if (result.coverReferences.orphanedBlobs.length > 0) {
    lines.push(`Orphaned blobs not referenced by books.cover_path or loans.snapshot_cover_path: ${result.coverReferences.orphanedBlobs.length}`)
    for (const orphan of result.coverReferences.orphanedBlobs.slice(0, 20)) {
      lines.push(`- ${orphan}`)
    }
    if (result.coverReferences.orphanedBlobs.length > 20) {
      lines.push(`- ... ${result.coverReferences.orphanedBlobs.length - 20} more`)
    }
  }

  for (const warning of result.warnings) {
    lines.push(`Warning: ${warning}`)
  }
  for (const error of result.errors) {
    lines.push(`Error: ${error}`)
  }

  return lines.join('\n')
}

async function readManifest(manifestPath) {
  if (!manifestPath) {
    throw new Error('manifestPath is required when manifest is not provided')
  }
  return JSON.parse(await readFile(resolve(manifestPath), 'utf8'))
}

async function readCoverReferences(client) {
  const [bookRows, loanRows] = await Promise.all([
    client.execute('select id, cover_path from books where cover_path is not null and cover_path <> \'\''),
    client.execute('select id, snapshot_cover_path from loans where snapshot_cover_path is not null and snapshot_cover_path <> \'\'')
  ])

  return [
    ...bookRows.rows.map(row => ({
      source: 'books',
      column: 'cover_path',
      id: String(row.id),
      path: normalizeBlobPath(String(row.cover_path))
    })),
    ...loanRows.rows.map(row => ({
      source: 'loans',
      column: 'snapshot_cover_path',
      id: String(row.id),
      path: normalizeBlobPath(String(row.snapshot_cover_path))
    }))
  ]
}

async function listBlobFiles(root) {
  const files = []

  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true }).catch((error) => {
      if (error?.code === 'ENOENT') {
        return []
      }
      throw error
    })

    for (const entry of entries) {
      const entryPath = join(current, entry.name)
      if (entry.isDirectory()) {
        await visit(entryPath)
      } else if (!entry.name.endsWith('.meta.json') && (await stat(entryPath)).isFile()) {
        files.push(normalizeBlobPath(relative(root, entryPath)))
      }
    }
  }

  await visit(root)
  return files.sort()
}

function normalizeBlobPath(pathname) {
  return pathname.replaceAll('\\', '/').replace(/^\/+/, '')
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function compareSemverish(a, b) {
  const parsedA = parseSemverish(a)
  const parsedB = parseSemverish(b)
  if (!parsedA || !parsedB) {
    return null
  }
  for (let index = 0; index < 3; index += 1) {
    if (parsedA[index] > parsedB[index]) return 1
    if (parsedA[index] < parsedB[index]) return -1
  }
  return 0
}

function parseSemverish(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) {
    return null
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}
