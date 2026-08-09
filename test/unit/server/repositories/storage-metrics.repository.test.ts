import { Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { StorageUsageSnapshotRepository, StorageUsageSnapshotRepositoryLive } from '../../../../server/repositories/storage-metrics.repository'
import { DbService } from '../../../../server/services/db.service'

describe('StorageUsageSnapshotRepository', () => {
  it('upserts and reads all storage snapshot fields', async () => {
    const snapshot = {
      totalBytes: 1_234_567,
      objectCount: 42,
      available: true,
      lastCalculatedAt: new Date('2026-07-01T12:00:00.000Z')
    }
    const returning = vi.fn(async () => [{ id: 'instance', ...snapshot }])
    const onConflictDoUpdate = vi.fn(() => ({ returning }))
    const values = vi.fn(() => ({ onConflictDoUpdate }))
    const insert = vi.fn(() => ({ values }))
    const limit = vi.fn(async () => [{ id: 'instance', ...snapshot }])
    const where = vi.fn(() => ({ limit }))
    const from = vi.fn(() => ({ where }))
    const select = vi.fn(() => ({ from }))
    const database = { insert, select }

    const result = await run(Effect.gen(function* () {
      const repository = yield* StorageUsageSnapshotRepository
      const saved = yield* repository.upsertSnapshot(snapshot)
      const loaded = yield* repository.getSnapshot()
      return { saved, loaded }
    }), database)

    expect(values).toHaveBeenCalledWith({ id: 'instance', ...snapshot })
    expect(onConflictDoUpdate).toHaveBeenCalledWith({
      target: expect.anything(),
      set: snapshot
    })
    expect(result).toEqual({ saved: snapshot, loaded: snapshot })
  })
})

function run<A>(effect: Effect.Effect<A, unknown, StorageUsageSnapshotRepository>, db: unknown) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(StorageUsageSnapshotRepositoryLive),
    Effect.provide(Layer.succeed(DbService, { db, executeAtomic: vi.fn() } as never))
  ))
}
