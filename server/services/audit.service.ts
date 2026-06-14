import { Context, Effect, Layer } from 'effect'
import { AuditRepository } from '../repositories/audit.repository'
import type { DatabaseError } from '../repositories/book.repository'
import type { DbService } from './db.service'

const DAY_IN_MS = 24 * 60 * 60 * 1000
const MAX_RETENTION_DAYS = Math.floor(8.64e15 / DAY_IN_MS)
const DEFAULT_AUTH_RETENTION_DAYS = 5
const DEFAULT_ADMIN_RETENTION_DAYS = 30

interface CleanupAuditInput {
  authRetentionDays?: unknown
  adminRetentionDays?: unknown
  now?: Date
}

interface CleanupAuditResult {
  authDeleted: number
  adminDeleted: number
  authRetentionDays: number
  adminRetentionDays: number
}

export interface AuditServiceInterface {
  cleanupExpiredEntries: (
    input?: CleanupAuditInput
  ) => Effect.Effect<CleanupAuditResult, DatabaseError, AuditRepository | DbService>
}

export class AuditService extends Context.Tag('AuditService')<AuditService, AuditServiceInterface>() { }

export const AuditServiceLive = Layer.effect(
  AuditService,
  Effect.gen(function* () {
    const auditRepository = yield* AuditRepository

    return {
      cleanupExpiredEntries: (input = {}) =>
        Effect.gen(function* () {
          const now = input.now ?? new Date()
          const authRetentionDays = parseRetentionDays(input.authRetentionDays, DEFAULT_AUTH_RETENTION_DAYS)
          const adminRetentionDays = parseRetentionDays(input.adminRetentionDays, DEFAULT_ADMIN_RETENTION_DAYS)
          const [authDeleted, adminDeleted] = yield* Effect.all([
            auditRepository.deleteOlderThan({
              category: 'auth',
              before: cutoffDate(now, authRetentionDays)
            }),
            auditRepository.deleteOlderThan({
              category: 'admin',
              before: cutoffDate(now, adminRetentionDays)
            })
          ], { concurrency: 'unbounded' })

          return {
            authDeleted,
            adminDeleted,
            authRetentionDays,
            adminRetentionDays
          }
        })
    }
  })
)

export const cleanupExpiredAuditEntries = (input?: CleanupAuditInput) =>
  Effect.flatMap(AuditService, service => service.cleanupExpiredEntries(input))

function parseRetentionDays(value: unknown, fallback: number) {
  const parsed = Number(value ?? fallback)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback

  const normalized = Math.trunc(parsed)
  return normalized <= MAX_RETENTION_DAYS ? normalized : fallback
}

function cutoffDate(now: Date, retentionDays: number) {
  return new Date(now.getTime() - (retentionDays * DAY_IN_MS))
}
