import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// This table intentionally has one fixed key. Each scheduled calculation
// replaces the instance-wide snapshot instead of retaining usage history.
export const storageUsageSnapshot = sqliteTable('storage_usage_snapshot', {
  id: text('id').primaryKey(),
  totalBytes: integer('total_bytes').notNull(),
  objectCount: integer('object_count').notNull(),
  available: integer('available', { mode: 'boolean' }).notNull(),
  lastCalculatedAt: integer('last_calculated_at', { mode: 'timestamp' }).notNull()
})
