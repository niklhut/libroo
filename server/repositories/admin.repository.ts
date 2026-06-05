import { Context, Effect, Layer } from 'effect'
import { inArray, sql } from 'drizzle-orm'
import { session } from 'hub:db:schema'
import { DatabaseError } from './book.repository'

export interface AdminRepositoryInterface {
  listLastActiveByUserIds: (userIds: string[]) => Effect.Effect<Record<string, Date | null>, DatabaseError, DbService>
}

export class AdminRepository extends Context.Tag('AdminRepository')<AdminRepository, AdminRepositoryInterface>() { }

export const AdminRepositoryLive = Layer.effect(
  AdminRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      listLastActiveByUserIds: userIds =>
        Effect.gen(function* () {
          if (userIds.length === 0) return {}

          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({
                userId: session.userId,
                lastActiveAt: sql<Date | number | string | null>`max(${session.updatedAt})`.as('last_active_at')
              })
              .from(session)
              .where(inArray(session.userId, userIds))
              .groupBy(session.userId),
            catch: error => new DatabaseError({
              message: `Failed to load user activity: ${error}`,
              operation: 'admin.listLastActiveByUserIds'
            })
          })

          return Object.fromEntries([
            ...userIds.map(userId => [userId, null] as const),
            ...rows.map(row => [row.userId, normalizeTimestamp(row.lastActiveAt)] as const)
          ])
        })
    }
  })
)

function normalizeTimestamp(value: Date | number | string | null): Date | null {
  if (!value) return null
  if (value instanceof Date) return value

  const numericValue = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(numericValue)) {
    return new Date(numericValue < 100000000000 ? numericValue * 1000 : numericValue)
  }

  return new Date(value)
}
