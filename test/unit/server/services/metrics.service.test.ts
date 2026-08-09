import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MetricsRepository } from '../../../../server/repositories/metrics.repository'
import { StorageUsageSnapshotRepository } from '../../../../server/repositories/storage-metrics.repository'
import { AdminAccessForbiddenError } from '../../../../server/utils/admin-access'
import { getAdminMetrics, MetricsServiceLive, STORAGE_USAGE_STALE_AFTER_MS } from '../../../../server/services/metrics.service'

describe('MetricsService', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('rejects non-admin actors before reading repositories', async () => {
    const metricsRepository = fakeMetricsRepository()
    const storageRepository = { getSnapshot: vi.fn(() => Effect.succeed(null)), upsertSnapshot: vi.fn() }

    const result = await run(Effect.either(getAdminMetrics({ actor: { id: 'user-1', role: 'user' }, headers: new Headers() })), metricsRepository, storageRepository)

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') expect(result.left).toBeInstanceOf(AdminAccessForbiddenError)
    expect(metricsRepository.countUsers).not.toHaveBeenCalled()
    expect(storageRepository.getSnapshot).not.toHaveBeenCalled()
  })

  it('aggregates core counts for an admin', async () => {
    const result = await run(getAdminMetrics({ actor: { id: 'admin-1', role: 'admin' }, headers: new Headers() }), fakeMetricsRepository({
      countUsers: 7,
      countCanonicalBooks: 8,
      countActiveUserBooks: 9,
      countActiveLoans: 10,
      countLocations: 11,
      countTags: 12
    }), { getSnapshot: vi.fn(() => Effect.succeed(null)), upsertSnapshot: vi.fn() })

    expect(result).toEqual({
      users: 7,
      library: { canonicalBooks: 8, activeUserBooks: 9, activeLoans: 10, locations: 11, tags: 12 },
      storage: { state: 'unavailable' }
    })
  })

  it.each([
    ['ok', { available: true, age: 0 }],
    ['stale', { available: true, age: STORAGE_USAGE_STALE_AFTER_MS + 1 }],
    ['unavailable', { available: false, age: 0 }]
  ] as const)('maps an %s storage snapshot state', async (state, { available, age }) => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-07-01T12:00:00.000Z').getTime())
    const snapshot = {
      totalBytes: 2 * 1024 * 1024,
      objectCount: 4,
      available,
      lastCalculatedAt: new Date(Date.now() - age)
    }
    const result = await run(getAdminMetrics({ actor: { id: 'admin-1', role: 'admin' }, headers: new Headers() }), fakeMetricsRepository(), {
      getSnapshot: vi.fn(() => Effect.succeed(snapshot)),
      upsertSnapshot: vi.fn()
    })

    expect(result.storage.state).toBe(state)
    if (state !== 'unavailable') {
      expect(result.storage).toMatchObject({ totalBytes: snapshot.totalBytes, objectCount: snapshot.objectCount, lastCalculatedAt: snapshot.lastCalculatedAt })
    }
  })

  it('degrades a storage snapshot error to unavailable', async () => {
    const result = await run(getAdminMetrics({ actor: { id: 'admin-1', role: 'admin' }, headers: new Headers() }), fakeMetricsRepository(), {
      getSnapshot: vi.fn(() => Effect.fail(new Error('snapshot unavailable'))),
      upsertSnapshot: vi.fn()
    })

    expect(result.storage).toEqual({ state: 'unavailable' })
  })
})

function fakeMetricsRepository(overrides: Partial<Record<string, number>> = {}) {
  const value = (key: string, fallback: number) => vi.fn(() => Effect.succeed(overrides[key] ?? fallback))
  return {
    countUsers: value('countUsers', 1),
    countCanonicalBooks: value('countCanonicalBooks', 2),
    countActiveUserBooks: value('countActiveUserBooks', 3),
    countActiveLoans: value('countActiveLoans', 4),
    countLocations: value('countLocations', 5),
    countTags: value('countTags', 6)
  }
}

function run<A, E>(
  effect: Effect.Effect<A, E, MetricsRepository | StorageUsageSnapshotRepository>,
  metricsRepository: ReturnType<typeof fakeMetricsRepository>,
  storageRepository: { getSnapshot: ReturnType<typeof vi.fn>, upsertSnapshot: ReturnType<typeof vi.fn> }
) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(MetricsServiceLive),
    Effect.provide(Layer.succeed(MetricsRepository, metricsRepository)),
    Effect.provide(Layer.succeed(StorageUsageSnapshotRepository, storageRepository))
  ))
}
