import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from './schema'
import * as authSchema from './auth-schema'

let databaseUrl: string
try {
  // Try to load from Nuxt's runtimeConfig
  databaseUrl = useRuntimeConfig().databaseUrl
} catch {
  // Fallback to .env config
  databaseUrl = process.env.NUXT_DATABASE_URL as string
}

if (!databaseUrl) {
  throw new Error('NUXT_DATABASE_URL is not defined in either runtimeConfig or environment variables.')
}

export const tables = {
  ...schema,
  ...authSchema
}

const db = drizzle(databaseUrl, {
  schema: tables
})

export default db
