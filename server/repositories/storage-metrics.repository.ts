import { Context, Effect, Layer } from 'effect'
import { eq } from 'drizzle-orm'
import { storageUsageSnapshot } from '../db/schema/storage-metrics'
import { DbService } from '../services/db.service'
import { DatabaseError } from './book.repository'

const STORAGE_USAGE_SNAPSHOT_ID = 'instance'

export interface StorageUsageSnapshot {
  totalBytes: number
  objectCount: number
  available: boolean
  lastCalculatedAt: Date
}

export interface StorageUsageSnapshotRepositoryInterface {
  getSnapshot: () => Effect.Effect<StorageUsageSnapshot | null, DatabaseError, DbService>
  upsertSnapshot: (value: StorageUsageSnapshot) => Effect.Effect<StorageUsageSnapshot, DatabaseError, DbService>
}

export class StorageUsageSnapshotRepository extends Context.Tag('StorageUsageSnapshotRepository')<StorageUsageSnapshotRepository, StorageUsageSnapshotRepositoryInterface>() { }

export const StorageUsageSnapshotRepositoryLive = Layer.effect(
  StorageUsageSnapshotRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    const toSnapshot = (row: typeof storageUsageSnapshot.$inferSelect): StorageUsageSnapshot => ({
      totalBytes: row.totalBytes,
      objectCount: row.objectCount,
      available: row.available,
      lastCalculatedAt: row.lastCalculatedAt
    })

    return {
      getSnapshot: () =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .select()
              .from(storageUsageSnapshot)
              .where(eq(storageUsageSnapshot.id, STORAGE_USAGE_SNAPSHOT_ID))
              .limit(1)
            return rows[0] ? toSnapshot(rows[0]) : null
          },
          catch: error => new DatabaseError({
            message: `Failed to load storage usage snapshot: ${error}`,
            operation: 'storageUsageSnapshot.get'
          })
        }),

      upsertSnapshot: value =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .insert(storageUsageSnapshot)
              .values({ id: STORAGE_USAGE_SNAPSHOT_ID, ...value })
              .onConflictDoUpdate({
                target: storageUsageSnapshot.id,
                set: value
              })
              .returning()
            const row = rows[0]
            if (!row) throw new Error('Storage usage snapshot was not returned after save')
            return toSnapshot(row)
          },
          catch: error => new DatabaseError({
            message: `Failed to save storage usage snapshot: ${error}`,
            operation: 'storageUsageSnapshot.upsert'
          })
        })
    }
  })
)
