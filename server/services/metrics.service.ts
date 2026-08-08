import { Context, Effect, Layer } from 'effect'
import type { AdminMetrics, AdminStorageMetrics } from '~~/shared/types/admin'
import type { DatabaseError } from '../repositories/book.repository'
import { MetricsRepository } from '../repositories/metrics.repository'
import { StorageUsageSnapshotRepository } from '../repositories/storage-metrics.repository'
import type { DbService } from './db.service'
import { AdminAccessForbiddenError as AdminForbiddenError, requireAdmin } from '../utils/admin-access'

const STORAGE_USAGE_STALE_AFTER_MS = 36 * 60 * 60 * 1000

interface AdminActor {
  id: string
  role?: string | null
}

export interface GetAdminMetricsInput {
  actor: AdminActor
  headers: Headers
}

export interface MetricsServiceInterface {
  getAdminMetrics: (input: GetAdminMetricsInput) => Effect.Effect<AdminMetrics, AdminForbiddenError | DatabaseError, DbService>
}

export class MetricsService extends Context.Tag('MetricsService')<MetricsService, MetricsServiceInterface>() { }

export const MetricsServiceLive = Layer.effect(
  MetricsService,
  Effect.gen(function* () {
    const metricsRepository = yield* MetricsRepository
    const storageUsageSnapshotRepository = yield* StorageUsageSnapshotRepository

    return {
      getAdminMetrics: input =>
        Effect.gen(function* () {
          yield* requireAdmin(input.actor, () => new AdminForbiddenError({ message: 'Admin access required' }))

          const [users, canonicalBooks, activeUserBooks, activeLoans, locations, tags] = yield* Effect.all([
            metricsRepository.countUsers(),
            metricsRepository.countCanonicalBooks(),
            metricsRepository.countActiveUserBooks(),
            metricsRepository.countActiveLoans(),
            metricsRepository.countLocations(),
            metricsRepository.countTags()
          ], { concurrency: 'unbounded' })

          const storage = yield* storageUsageSnapshotRepository.getSnapshot().pipe(
            Effect.map(snapshot => toStorageMetrics(snapshot)),
            Effect.catchAll(() => Effect.succeed<AdminStorageMetrics>({ state: 'unavailable' }))
          )

          return {
            users,
            library: { canonicalBooks, activeUserBooks, activeLoans, locations, tags },
            storage
          }
        })
    }
  })
)

export const getAdminMetrics = (input: GetAdminMetricsInput) =>
  Effect.flatMap(MetricsService, service => service.getAdminMetrics(input))

function toStorageMetrics(snapshot: {
  totalBytes: number
  objectCount: number
  available: boolean
  lastCalculatedAt: Date
} | null): AdminStorageMetrics {
  if (!snapshot?.available) return { state: 'unavailable' }

  return {
    state: Date.now() - snapshot.lastCalculatedAt.getTime() > STORAGE_USAGE_STALE_AFTER_MS ? 'stale' : 'ok',
    totalBytes: snapshot.totalBytes,
    totalMegabytes: snapshot.totalBytes / (1024 * 1024),
    totalGigabytes: snapshot.totalBytes / (1024 * 1024 * 1024),
    objectCount: snapshot.objectCount,
    lastCalculatedAt: snapshot.lastCalculatedAt
  }
}

export { STORAGE_USAGE_STALE_AFTER_MS }
