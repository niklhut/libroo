import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema/index.ts',
  out: './server/db/migrations/sqlite',
  dbCredentials: {
    url: '.data/db/sqlite.db'
  }
})
