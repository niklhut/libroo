import { randomUUID } from 'node:crypto'
import { Context, Effect, Layer } from 'effect'
import { aliasedTable, and, desc, eq, lt, sql } from 'drizzle-orm'
import { db } from '@nuxthub/db'
import { adminAuditLog, user } from 'hub:db:schema'
import type { AdminAuditAction, AdminAuditCategory, AdminAuditEntry } from '~~/shared/types/admin-audit'
import { DatabaseError } from './book.repository'
import { DbService } from '../services/db.service'
import type { DbServiceInterface } from '../services/db.service'

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
          try: async () => {
            await ensureAdminAuditLogCompatibility(dbService.db)
            return createAdminAuditEntryInDatabase(input, dbService.db)
          },
          catch: error => new DatabaseError({
            message: `Failed to create admin audit entry: ${error}`,
            operation: 'audit.create'
          })
        }),

      list: input =>
        Effect.tryPromise({
          try: async () => {
            await ensureAdminAuditLogCompatibility(dbService.db)
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
            await ensureAdminAuditLogCompatibility(dbService.db)
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

export async function ensureAdminAuditLogCompatibility(database: DbServiceInterface['db'] = db) {
  const columns = await getAdminAuditLogColumns(database)
  if (columns.length === 0) return

  const hasCategory = columns.some(column => column.name === 'category')
  const actorUserIdColumn = columns.find(column => column.name === 'actor_user_id')
  const actorUserIdIsRequired = actorUserIdColumn?.notnull === 1

  if (!hasCategory && !actorUserIdIsRequired) {
    await database.run(sql`ALTER TABLE admin_audit_log ADD COLUMN category text NOT NULL DEFAULT 'admin'`)
    await database.run(sql`CREATE INDEX IF NOT EXISTS admin_audit_log_category_idx ON admin_audit_log (category)`)
    return
  }

  if (!hasCategory || actorUserIdIsRequired) {
    await rebuildAdminAuditLogTable(database, hasCategory)
  }
}

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

async function getAdminAuditLogColumns(database: DbServiceInterface['db']) {
  const result = await database.run(sql`PRAGMA table_info(admin_audit_log)`)
  const rows = 'rows' in result && Array.isArray(result.rows) ? result.rows : []

  return rows.map(row => ({
    name: String((row as Record<string, unknown>).name),
    notnull: Number((row as Record<string, unknown>).notnull)
  }))
}

async function rebuildAdminAuditLogTable(database: DbServiceInterface['db'], hasCategory: boolean) {
  await database.run(sql`PRAGMA foreign_keys=OFF`)
  await database.run(sql`
    CREATE TABLE IF NOT EXISTS __new_admin_audit_log (
      id text PRIMARY KEY NOT NULL,
      category text NOT NULL DEFAULT 'admin',
      actor_user_id text REFERENCES "user"(id) ON DELETE set null,
      target_user_id text REFERENCES "user"(id) ON DELETE set null,
      action text NOT NULL,
      metadata text,
      created_at integer NOT NULL
    )
  `)
  await database.run(sql`
    INSERT INTO __new_admin_audit_log (
      id,
      category,
      actor_user_id,
      target_user_id,
      action,
      metadata,
      created_at
    )
    SELECT
      id,
      ${hasCategory ? sql`category` : sql`'admin'`},
      actor_user_id,
      target_user_id,
      action,
      metadata,
      created_at
    FROM admin_audit_log
  `)
  await database.run(sql`DROP TABLE admin_audit_log`)
  await database.run(sql`ALTER TABLE __new_admin_audit_log RENAME TO admin_audit_log`)
  await database.run(sql`CREATE INDEX IF NOT EXISTS admin_audit_log_category_idx ON admin_audit_log (category)`)
  await database.run(sql`CREATE INDEX IF NOT EXISTS admin_audit_log_actor_user_id_idx ON admin_audit_log (actor_user_id)`)
  await database.run(sql`CREATE INDEX IF NOT EXISTS admin_audit_log_target_user_id_idx ON admin_audit_log (target_user_id)`)
  await database.run(sql`CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON admin_audit_log (action)`)
  await database.run(sql`CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON admin_audit_log (created_at)`)
  await database.run(sql`PRAGMA foreign_keys=ON`)
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
