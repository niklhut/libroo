import { randomUUID } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { aliasedTable, and, desc, eq, lt, sql } from 'drizzle-orm'
import { db, schema } from '../runtime/auth-db.active'
import type { AdminAuditAction, AdminAuditCategory, AdminAuditEntry } from '~~/shared/types/admin-audit'
import { DatabaseError } from './book.repository'
import { DbService } from '../services/db.service'
import type { DbServiceInterface } from '../services/db.service'

const { adminAuditLog, user } = schema

export interface CreateAdminAuditEntryInput {
  category: AdminAuditCategory
  actorUserId: string | null
  targetUserId: string | null
  action: AdminAuditAction
  metadata?: Record<string, unknown> | null
}

export interface AuditRepositoryInterface {
  create: (input: CreateAdminAuditEntryInput) => Effect.Effect<AdminAuditEntry, DatabaseError, DbService>
  list: (input: { limit: number, offset: number, category?: AdminAuditCategory | null }) => Effect.Effect<{ entries: AdminAuditEntry[], total: number }, DatabaseError, DbService>
  deleteOlderThan: (input: { category: AdminAuditCategory, before: Date }) => Effect.Effect<number, DatabaseError, DbService>
}

export class AuditRepository extends Context.Tag('AuditRepository')<AuditRepository, AuditRepositoryInterface>() { }

export const AuditRepositoryLive = Layer.effect(
  AuditRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      create: input =>
        Effect.tryPromise({
          try: () => createAdminAuditEntryInDatabase(input, dbService.db),
          catch: error => new DatabaseError({
            message: `Failed to create admin audit entry: ${error}`,
            operation: 'audit.create'
          })
        }),

      list: input =>
        Effect.tryPromise({
          try: async () => {
            const actorUser = aliasedTable(user, 'actor_user')
            const targetUser = aliasedTable(user, 'target_user')
            const whereClause = input.category
              ? eq(adminAuditLog.category, input.category)
              : undefined
            const [rows, totals] = await Promise.all([
              dbService.db
                .select({
                  id: adminAuditLog.id,
                  category: adminAuditLog.category,
                  actorUserId: adminAuditLog.actorUserId,
                  actorName: actorUser.name,
                  actorEmail: actorUser.email,
                  targetUserId: adminAuditLog.targetUserId,
                  targetName: targetUser.name,
                  targetEmail: targetUser.email,
                  action: adminAuditLog.action,
                  metadata: adminAuditLog.metadata,
                  createdAt: adminAuditLog.createdAt
                })
                .from(adminAuditLog)
                .leftJoin(actorUser, eq(adminAuditLog.actorUserId, actorUser.id))
                .leftJoin(targetUser, eq(adminAuditLog.targetUserId, targetUser.id))
                .where(whereClause)
                .orderBy(desc(adminAuditLog.createdAt))
                .limit(input.limit)
                .offset(input.offset),
              dbService.db
                .select({ count: sql<number>`count(*)` })
                .from(adminAuditLog)
                .where(whereClause)
            ])

            return {
              entries: rows.map(toAdminAuditEntry),
              total: Number(totals[0]?.count ?? 0)
            }
          },
          catch: error => new DatabaseError({
            message: `Failed to list admin audit entries: ${error}`,
            operation: 'audit.list'
          })
        }),

      deleteOlderThan: input =>
        Effect.tryPromise({
          try: async () => {
            const result = await dbService.db
              .delete(adminAuditLog)
              .where(and(
                eq(adminAuditLog.category, input.category),
                lt(adminAuditLog.createdAt, input.before)
              ))

            return getAffectedRowCount(result)
          },
          catch: error => new DatabaseError({
            message: `Failed to delete expired admin audit entries: ${error}`,
            operation: 'audit.deleteExpired'
          })
        })
    }
  })
)

export async function createAdminAuditEntryInDatabase(
  input: CreateAdminAuditEntryInput,
  database: DbServiceInterface['db'] = db
) {
  const entry = {
    id: randomUUID(),
    category: input.category,
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    action: input.action,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    createdAt: new Date()
  }

  await database.insert(adminAuditLog).values(entry)
  return toAdminAuditEntry(entry)
}

function toAdminAuditEntry(row: {
  id: string
  category: string
  actorUserId: string | null
  actorName?: string | null
  actorEmail?: string | null
  targetUserId: string | null
  targetName?: string | null
  targetEmail?: string | null
  action: string
  metadata: string | null
  createdAt: Date
}): AdminAuditEntry {
  return {
    id: row.id,
    category: row.category as AdminAuditCategory,
    actorUserId: row.actorUserId,
    actor: row.actorUserId && row.actorName && row.actorEmail
      ? {
          id: row.actorUserId,
          name: row.actorName,
          email: row.actorEmail
        }
      : null,
    targetUserId: row.targetUserId,
    target: row.targetUserId && row.targetName && row.targetEmail
      ? {
          id: row.targetUserId,
          name: row.targetName,
          email: row.targetEmail
        }
      : null,
    action: row.action as AdminAuditAction,
    metadata: parseMetadata(row.metadata),
    createdAt: row.createdAt
  }
}

function getAffectedRowCount(result: unknown) {
  if (typeof result === 'object' && result) {
    const record = result as Record<string, unknown>
    if (typeof record.rowsAffected === 'number') return record.rowsAffected
    if (typeof record.changes === 'number') return record.changes
  }

  return 0
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null

  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}
