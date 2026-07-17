import { Effect } from 'effect'
import { cleanupExpiredAuditEntries } from '../../server/services/audit.service'
import { cleanupExpiredRateLimitCounters } from '../../server/services/rate-limit.service'
import { getBooksRateLimitConfig } from '../../server/utils/books-config'
import { runEffect } from '../../server/utils/effect'

export default defineTask({
  meta: {
    name: 'audit:cleanup',
    description: 'Delete expired audit entries and rate-limit counters.'
  },
  run: async () => {
    const config = useRuntimeConfig()
    const booksRateLimit = getBooksRateLimitConfig()
    const result = await runEffect(Effect.gen(function* () {
      const audit = yield* cleanupExpiredAuditEntries({
        authRetentionDays: config.authAuditRetentionDays,
        adminRetentionDays: config.adminAuditRetentionDays
      })
      const rateLimits = yield* cleanupExpiredRateLimitCounters({
        windowSeconds: booksRateLimit.windowSeconds
      })

      return { audit, rateLimits }
    }))

    console.info('Expired data cleanup completed', result)
    return { result }
  }
})
