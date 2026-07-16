import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/** Shared fixed-window counters for application-level rate limiting. */
export const rateLimitCounters = sqliteTable('rate_limit_counters', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  windowStart: integer('window_start', { mode: 'number' }).notNull()
})
