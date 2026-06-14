import { Effect } from 'effect'
import { cleanupExpiredAuditEntries } from '../../server/services/audit.service'
import { runEffect } from '../../server/utils/effect'

export default defineTask({
  meta: {
    name: 'audit:cleanup',
    description: 'Delete expired admin and auth audit log entries.'
  },
  run: async () => {
    const config = useRuntimeConfig()
    const result = await runEffect(Effect.gen(function* () {
      return yield* cleanupExpiredAuditEntries({
        authRetentionDays: config.authAuditRetentionDays,
        adminRetentionDays: config.adminAuditRetentionDays
      })
    }))

    console.info('Audit cleanup completed', result)
    return { result }
  }
})
