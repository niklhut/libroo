import { Context, Effect, Layer } from 'effect'
import { inArray, sql } from 'drizzle-orm'
import { session } from 'hub:db:schema'
import { DatabaseError } from './book.repository'

export interface AdminRepositoryInterface {
  listLastSessionActivityByUserIds: (userIds: string[]) => Effect.Effect<Record<string, Date | null>, DatabaseError, DbService>
}

export class AdminRepository extends Context.Tag('AdminRepository')<AdminRepository, AdminRepositoryInterface>() { }

export const AdminRepositoryLive = Layer.effect(
  AdminRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      listLastSessionActivityByUserIds: userIds =>
        Effect.gen(function* () {
          if (userIds.length === 0) return {}

          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({
                userId: session.userId,
                lastSessionActivityAt: sql<Date | number | string | null>`max(${session.updatedAt})`.as('last_session_activity_at')
              })
              .from(session)
              .where(inArray(session.userId, userIds))
              .groupBy(session.userId),
            catch: error => new DatabaseError({
              message: `Failed to load user activity: ${error}`,
              operation: 'admin.listLastSessionActivityByUserIds'
            })
          })

          return Object.fromEntries([
            ...userIds.map(userId => [userId, null] as const),
            ...rows.map(row => [row.userId, normalizeTimestamp(row.lastSessionActivityAt)] as const)
          ])
        })
    }
  })
)

function normalizeTimestamp(value: Date | number | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null

  const numericValue = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(numericValue)) {
    const date = new Date(numericValue < 100000000000 ? numericValue * 1000 : numericValue)
    return Number.isFinite(date.getTime()) ? date : null
  }

  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}
