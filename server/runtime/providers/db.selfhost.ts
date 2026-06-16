import { Layer } from 'effect'
import { createClient } from '@libsql/client/node'
import { drizzle } from 'drizzle-orm/libsql/node'
import * as schema from '../../db/schema'
import { DbService } from '../../services/db.service'
import type { DbServiceInterface } from '../../services/db.service'

function getDatabaseUrl() {
  return process.env.NUXT_DATABASE_URL
    || process.env.LIBROO_DATABASE_URL
    || 'file:.data/db/sqlite.db'
}

export const DbServiceSelfHostLive = Layer.sync(DbService, () => {
  const client = createClient({
    url: getDatabaseUrl()
  })

  return {
    db: drizzle(client, { schema }) as unknown as DbServiceInterface['db']
  }
})
