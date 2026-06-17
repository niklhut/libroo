import { mkdirSync, rmSync, statfsSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createClient } from '@libsql/client/node'
import { drizzle } from 'drizzle-orm/libsql/node'
import { migrate } from 'drizzle-orm/libsql/migrator'

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

function assertDatabaseStorageReady(databasePath) {
  const databaseDirectory = dirname(databasePath)
  mkdirSync(databaseDirectory, { recursive: true })

  const probePath = resolve(databaseDirectory, `.libroo-write-test-${Date.now()}`)
  try {
    writeFileSync(probePath, 'ok')
  } catch (error) {
    throw new Error([
      `Libroo cannot write to the database directory: ${databaseDirectory}`,
      'Check the Docker volume or bind-mount permissions for /data.',
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    ].join('\n'))
  } finally {
    rmSync(probePath, { force: true })
  }

  try {
    const stats = statfsSync(databaseDirectory)
    const availableBytes = Number(stats.bavail) * Number(stats.bsize)

    if (availableBytes < 16 * 1024 * 1024) {
      throw new Error([
        `Libroo database directory has only ${formatBytes(availableBytes)} available: ${databaseDirectory}`,
        'Free space in Docker Desktop, prune unused Docker data, increase the Docker disk image size, or mount /data on a volume with more space.'
      ].join('\n'))
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Libroo database directory has only')) {
      throw error
    }
    console.warn(`Could not inspect free space for ${databaseDirectory}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const databaseUrl = getDatabaseUrl()
const databasePath = databasePathFromUrl(databaseUrl)

if (databasePath) {
  assertDatabaseStorageReady(databasePath)
}

const client = createClient({ url: databaseUrl })
const db = drizzle(client)

try {
  await migrate(db, {
    migrationsFolder: resolve('server/db/migrations')
  })
} catch (error) {
  const cause = error?.cause
  const code = cause?.code || cause?.cause?.code
  if (code === 'SQLITE_FULL') {
    throw new Error([
      'Libroo could not migrate the SQLite database because SQLite reported SQLITE_FULL.',
      'The Docker volume mounted at /data is out of writable space or the Docker Desktop disk image is full.',
      'Free Docker disk space, increase the Docker disk image size, or recreate/move the libroo-data volume, then start the container again.',
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    ].join('\n'))
  }

  throw error
} finally {
  client.close()
}
