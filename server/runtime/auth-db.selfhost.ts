import { createClient } from '@libsql/client/node'
import { drizzle } from 'drizzle-orm/libsql/node'
import * as schema from '../db/schema'

function getDatabaseUrl() {
  return process.env.NUXT_DATABASE_URL
    || process.env.LIBROO_DATABASE_URL
    || 'file:.data/db/sqlite.db'
}

const client = createClient({
  url: getDatabaseUrl()
})

export const db = drizzle(client, { schema })
export const user = schema.user
export { schema }
