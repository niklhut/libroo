#!/usr/bin/env node
import { cp, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { createGzip } from 'node:zlib'
import { createClient } from '@libsql/client/node'
import { buildBackupManifest, MANIFEST_FILENAME } from './lib/backup-metadata.mjs'

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

function formatBytes(bytes) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

async function assertWritableDirectory(directory, label) {
  await mkdir(directory, { recursive: true })
  const probePath = join(directory, `.libroo-write-test-${Date.now()}`)
  try {
    await writeFile(probePath, 'ok')
  } catch (error) {
    throw new Error([
      `Libroo cannot write to the ${label}: ${directory}`,
      'Check the Docker volume or bind-mount permissions for /data.',
      `Original error: ${formatError(error)}`
    ].join('\n'), { cause: error })
  } finally {
    await rm(probePath, { force: true })
  }
}

async function assertSufficientFreeSpace(outputDirectory, sourcePaths) {
  let requiredBytes = 64 * 1024 * 1024
  for (const sourcePath of sourcePaths) {
    requiredBytes += await pathSize(sourcePath)
  }

  try {
    const stats = await statfs(outputDirectory)
    const availableBytes = Number(stats.bavail) * Number(stats.bsize)
    if (availableBytes < requiredBytes) {
      throw new Error([
        `Libroo backup output has only ${formatBytes(availableBytes)} available: ${outputDirectory}`,
        `Estimated backup working space required: ${formatBytes(requiredBytes)}.`,
        'Free space in Docker Desktop, prune unused Docker data, increase the Docker disk image size, or write backups to a volume with more space.'
      ].join('\n'))
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Libroo backup output has only')) {
      throw error
    }
    console.warn(`Could not inspect free space for ${outputDirectory}: ${formatError(error)}`)
  }
}

async function statfs(pathname) {
  const { statfs } = await import('node:fs/promises')
  return statfs(pathname)
}

async function pathSize(pathname) {
  const stats = await stat(pathname).catch((error) => {
    if (error?.code === 'ENOENT') {
      return null
    }
    throw error
  })
  if (!stats) return 0
  if (stats.isFile()) return stats.size
  if (!stats.isDirectory()) return 0

  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(pathname, { withFileTypes: true })
  const childSizes = await Promise.all(entries.map(entry => pathSize(join(pathname, entry.name))))
  return childSizes.reduce((sum, size) => sum + size, 0)
}

async function vacuumInto(client, snapshotPath) {
  const sqlPath = snapshotPath.replaceAll('\'', '\'\'')
  await client.execute(`vacuum into '${sqlPath}'`)
}

async function createTarGz(sourceDirectory, archivePath) {
  const output = createWriteStream(archivePath)
  const tar = spawn('tar', ['-cf', '-', '-C', sourceDirectory, '.'], {
    stdio: ['ignore', 'pipe', 'pipe']
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
    pipeline(tar.stdout, createGzip({ level: 9 }), output),
    exitPromise
  ])
}

function parseArgs(argv) {
  const options = {
    outputDir: process.env.LIBROO_BACKUP_DIR || '.data/backups'
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--output-dir') {
      options.outputDir = argv[++index]
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function printHelp() {
  console.log(`Usage: node scripts/backup-selfhost.mjs [--output-dir <dir>]

Environment:
  NUXT_DATABASE_URL or LIBROO_DATABASE_URL
  NUXT_LOCAL_STORAGE_DIR or LIBROO_LOCAL_STORAGE_DIR
  LIBROO_BACKUP_DIR`)
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  printHelp()
  process.exit(0)
}

const databaseUrl = getDatabaseUrl()
const databasePath = databasePathFromUrl(databaseUrl)
if (!databasePath) {
  throw new Error('Self-hosted backup requires a file: SQLite/libSQL database URL. Remote database URLs are not supported by this script.')
}

const blobDir = resolve(getLocalStorageRoot())
const outputDir = resolve(options.outputDir)
const startedAt = new Date()
const timestamp = startedAt.toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
const archivePath = join(outputDir, `libroo-selfhost-backup-${timestamp}.tar.gz`)
const tempRoot = await mkdtemp(join(tmpdir(), 'libroo-backup-'))
const stagingDir = join(tempRoot, 'artifact')
const snapshotPath = join(tempRoot, 'sqlite.db')
const client = createClient({ url: databaseUrl })

try {
  console.log(`Preparing backup output directory: ${outputDir}`)
  await assertWritableDirectory(outputDir, 'backup output directory')
  await assertSufficientFreeSpace(outputDir, [databasePath, blobDir])

  console.log('Taking online database snapshot with VACUUM INTO...')
  await vacuumInto(client, snapshotPath)
  const databaseSnapshotAt = new Date()

  console.log('Copying database snapshot into artifact...')
  await mkdir(join(stagingDir, 'database'), { recursive: true })
  await cp(snapshotPath, join(stagingDir, 'database', 'sqlite.db'))

  console.log('Copying blob directory, including .meta.json sidecars...')
  await mkdir(join(stagingDir, 'blob'), { recursive: true })
  await cp(blobDir, join(stagingDir, 'blob'), {
    recursive: true,
    force: true,
    errorOnExist: false,
    preserveTimestamps: true
  }).catch((error) => {
    if (error?.code === 'ENOENT') {
      console.warn(`Blob directory does not exist yet; writing an empty blob tree: ${blobDir}`)
      return
    }
    throw error
  })

  console.log('Writing backup manifest...')
  const manifest = await buildBackupManifest({
    client,
    runtimeProfile: process.env.NUXT_LIBROO_RUNTIME_PROFILE || 'selfhost',
    createdAt: startedAt,
    databaseSnapshotAt,
    completedAt: new Date(),
    extraRuntime: {
      databaseUrlKind: 'file',
      blobStorage: 'local'
    }
  })
  await writeFile(join(stagingDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`Bundling archive: ${archivePath}`)
  await createTarGz(stagingDir, archivePath)
  console.log(`Backup complete: ${archivePath}`)
} catch (error) {
  const code = error?.code || error?.cause?.code
  if (code === 'SQLITE_FULL') {
    throw new Error([
      'Libroo could not snapshot the SQLite database because SQLite reported SQLITE_FULL.',
      'The Docker volume mounted at /data is out of writable space or the Docker Desktop disk image is full.',
      'Free Docker disk space, increase the Docker disk image size, or write the backup to a volume with more space.',
      `Original error: ${formatError(error)}`
    ].join('\n'), { cause: error })
  }
  throw error
} finally {
  client.close()
  await rm(tempRoot, { recursive: true, force: true })
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}
