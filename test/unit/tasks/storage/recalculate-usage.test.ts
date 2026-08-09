import { Effect, Layer } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageUsageSnapshotRepository } from '../../../../server/repositories/storage-metrics.repository'
import { StorageService } from '../../../../server/services/storage.service'

vi.stubGlobal('defineTask', <T>(task: T) => task)

vi.mock('../../../../server/utils/effect', () => ({
  runEffect: vi.fn()
}))

const { recalculateStorageUsage } = await import('../../../../tasks/storage/recalculate-usage')

describe('storage:recalculate-usage', () => {
  afterEach(() => vi.restoreAllMocks())

  it('calculates cover usage and stores an available snapshot with a timestamp', async () => {
    const getUsage = vi.fn(() => Effect.succeed({ available: true, totalBytes: 987, objectCount: 6 }))
    const upsertSnapshot = vi.fn(value => Effect.succeed(value))
    const before = Date.now()

    const result = await Effect.runPromise(recalculateStorageUsage().pipe(
      Effect.provide(Layer.succeed(StorageService, { getUsage } as never)),
      Effect.provide(Layer.succeed(StorageUsageSnapshotRepository, { upsertSnapshot } as never))
    ))

    expect(getUsage).toHaveBeenCalledWith('covers/')
    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      available: true,
      totalBytes: 987,
      objectCount: 6,
      lastCalculatedAt: expect.any(Date)
    }))
    expect(result.lastCalculatedAt.getTime()).toBeGreaterThanOrEqual(before)
  })

  it('stores unavailable results instead of converting them to failures', async () => {
    const getUsage = vi.fn(() => Effect.succeed({ available: false, totalBytes: 0, objectCount: 0 }))
    const upsertSnapshot = vi.fn(value => Effect.succeed(value))

    await Effect.runPromise(recalculateStorageUsage().pipe(
      Effect.provide(Layer.succeed(StorageService, { getUsage } as never)),
      Effect.provide(Layer.succeed(StorageUsageSnapshotRepository, { upsertSnapshot } as never))
    ))

    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({ available: false }))
  })
})
