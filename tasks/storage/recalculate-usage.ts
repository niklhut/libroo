import { Effect } from 'effect'
import { StorageUsageSnapshotRepository } from '../../server/repositories/storage-metrics.repository'
import { StorageService } from '../../server/services/storage.service'
import { runEffect } from '../../server/utils/effect'

export const recalculateStorageUsage = () =>
  Effect.gen(function* () {
    const storageService = yield* StorageService
    const storageUsageSnapshotRepository = yield* StorageUsageSnapshotRepository
    const usage = yield* storageService.getUsage('covers/')
    const snapshot = yield* storageUsageSnapshotRepository.upsertSnapshot({
      totalBytes: usage.totalBytes,
      objectCount: usage.objectCount,
      available: usage.available,
      lastCalculatedAt: new Date()
    })
    return snapshot
  })

export default defineTask({
  meta: {
    name: 'storage:recalculate-usage',
    description: 'Recalculate the approximate storage used by cover blobs.'
  },
  run: async () => {
    const result = await runEffect(recalculateStorageUsage())
    console.info('Storage usage recalculation completed', result)
    return { result }
  }
})
