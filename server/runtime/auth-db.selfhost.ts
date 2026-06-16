import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@libsql/client/node'
import { drizzle } from 'drizzle-orm/libsql/node'
import * as schema from '../db/schema'

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

function databasePathFromUrl(url: string) {
  if (!url.startsWith('file:')) {
    return null
  }

  const pathname = url.slice('file:'.length)
  return pathname && pathname !== ':memory:' ? pathname : null
}

function ensureDatabaseDirectory(url: string) {
  const databasePath = databasePathFromUrl(url)
  if (databasePath) {
    mkdirSync(dirname(databasePath), { recursive: true })
  }
}

const databaseUrl = getDatabaseUrl()
ensureDatabaseDirectory(databaseUrl)

const client = createClient({
  url: databaseUrl
})

export const db = drizzle(client, { schema })
export const user = schema.user
export { schema }
