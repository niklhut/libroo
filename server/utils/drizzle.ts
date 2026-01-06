import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import * as schema from 'hub:db:schema'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function useDrizzle() {
  if (_db) {
    return _db
  }

  const client = createClient({
    url: 'file:.data/db/sqlite.db'
  })

  _db = drizzle(client, { schema })
  return _db
}

export type DrizzleDB = ReturnType<typeof useDrizzle>
