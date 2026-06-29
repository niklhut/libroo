#!/usr/bin/env node
import { cp, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { createGunzip } from 'node:zlib'
import { createClient } from '@libsql/client/node'
import { drizzle } from 'drizzle-orm/libsql/node'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { MANIFEST_FILENAME } from './lib/backup-metadata.mjs'
import { formatVerificationReport, verifyBackupTarget } from './lib/backup-verify.mjs'

function getDatabaseUrl() {
  const configuredUrl = process.env.NUXT_DATABASE_URL || process.env.LIBROO_DATABASE_URL
  if (configuredUrl && configuredUrl.trim() !== '') {
    return configuredUrl.trim()
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('NUXT_DATABASE_URL or LIBROO_DATABASE_URL must be set in production')
  }

  return 'file:.data/db/sqlite.db'
}

function getLocalStorageRoot() {
  return process.env.NUXT_LOCAL_STORAGE_DIR
    || process.env.LIBROO_LOCAL_STORAGE_DIR
    || '.data/blob'
}

function databasePathFromUrl(url) {
  if (!url.startsWith('file:')) {
    return null
  }

  const pathname = url.slice('file:'.length)
  return pathname && pathname !== ':memory:' ? pathname : null
}

async function extractTarGz(archivePath, destination) {
  await mkdir(destination, { recursive: true })
  const tar = spawn('tar', ['-xf', '-', '-C', destination], {
    stdio: ['pipe', 'inherit', 'pipe']
  })
  let stderr = ''
  tar.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  const exitPromise = new Promise((resolvePromise, reject) => {
    tar.on('error', reject)
    tar.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
      } else {
        reject(new Error(`tar failed with exit code ${code}: ${stderr.trim()}`))
      }
    })
  })

  await Promise.all([
    pipeline(createReadStream(archivePath), createGunzip(), tar.stdin),
    exitPromise
  ])
}

async function isDirectoryEmpty(directory) {
  const entries = await readdir(directory).catch((error) => {
    if (error?.code === 'ENOENT') {
      return []
    }
    throw error
  })
  return entries.length === 0
}

async function assertCleanTarget({ databasePath, blobDir, force }) {
  const dbStats = await stat(databasePath).catch((error) => {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  })
  const blobEmpty = await isDirectoryEmpty(blobDir)

  if (!force && ((dbStats && dbStats.size > 0) || !blobEmpty)) {
    throw new Error([
      'Refusing to restore into a non-empty target.',
      `Database path: ${databasePath}${dbStats ? ` (${dbStats.size} bytes)` : ' (absent)'}`,
      `Blob directory: ${blobDir}${blobEmpty ? ' (empty or absent)' : ' (not empty)'}`,
      'Restore into a clean environment, or pass --force after taking a backup of the current target.'
    ].join('\n'))
  }
}

async function runMigrations(databaseUrl) {
  const client = createClient({ url: databaseUrl })
  const db = drizzle(client)
  try {
    await migrate(db, {
      migrationsFolder: resolve('server/db/migrations/sqlite')
    })
  } catch (error) {
    const code = error?.code || error?.cause?.code || error?.cause?.cause?.code
    if (code === 'SQLITE_FULL') {
      throw new Error([
        'Libroo could not migrate the restored SQLite database because SQLite reported SQLITE_FULL.',
        'The Docker volume mounted at /data is out of writable space or the Docker Desktop disk image is full.',
        'Free Docker disk space, increase the Docker disk image size, or restore to a volume with more space.',
        `Original error: ${formatError(error)}`
      ].join('\n'), { cause: error })
    }
    throw error
  } finally {
    client.close()
  }
}

function parseArgs(argv) {
  const options = {
    force: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--force') {
      options.force = true
    } else if (arg === '--archive') {
      options.archive = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if (!options.archive) {
      options.archive = arg
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage: node scripts/restore-selfhost.mjs <archive.tar.gz> [--force]

Environment:
  NUXT_DATABASE_URL or LIBROO_DATABASE_URL
  NUXT_LOCAL_STORAGE_DIR or LIBROO_LOCAL_STORAGE_DIR`)
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  printHelp()
  process.exit(0)
}
if (!options.archive) {
  throw new Error('Missing backup archive path. Run with --help for usage.')
}

const archivePath = resolve(options.archive)
const databaseUrl = getDatabaseUrl()
const databasePath = databasePathFromUrl(databaseUrl)
if (!databasePath) {
  throw new Error('Self-hosted restore requires a file: SQLite/libSQL database URL. Remote database URLs are not supported by this script.')
}

const resolvedDatabasePath = resolve(databasePath)
const blobDir = resolve(getLocalStorageRoot())
const tempRoot = await mkdtemp(join(tmpdir(), 'libroo-restore-'))
const extractDir = join(tempRoot, 'artifact')

try {
  console.log(`Checking restore target: ${resolvedDatabasePath} and ${blobDir}`)
  await assertCleanTarget({
    databasePath: resolvedDatabasePath,
    blobDir,
    force: options.force
  })

  console.log(`Unpacking archive: ${archivePath}`)
  await extractTarGz(archivePath, extractDir)

  const sourceDatabasePath = join(extractDir, 'database', 'sqlite.db')
  const sourceBlobDir = join(extractDir, 'blob')
  const manifestPath = join(extractDir, MANIFEST_FILENAME)

  await stat(sourceDatabasePath)
  await stat(manifestPath)

  console.log('Restoring database file...')
  await mkdir(dirname(resolvedDatabasePath), { recursive: true })
  await rm(resolvedDatabasePath, { force: true })
  await cp(sourceDatabasePath, resolvedDatabasePath)

  console.log('Restoring blob directory...')
  await rm(blobDir, { recursive: true, force: true })
  await mkdir(dirname(blobDir), { recursive: true })
  await cp(sourceBlobDir, blobDir, {
    recursive: true,
    force: true,
    errorOnExist: false,
    preserveTimestamps: true
  })

  console.log('Applying current Drizzle migrations...')
  await runMigrations(databaseUrl)

  console.log('Verifying restored backup...')
  const verification = await verifyBackupTarget({
    databaseUrl,
    blobDir,
    manifestPath
  })
  console.log(formatVerificationReport(verification))

  if (!verification.ok) {
    process.exitCode = 1
  } else {
    console.log('Restore complete.')
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}
