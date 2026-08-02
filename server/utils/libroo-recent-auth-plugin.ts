import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'
import { Effect } from 'effect'
import { RecentAuthError, RecentAuthService, RecentAuthServiceLive } from '../services/recent-auth.service'

const RECENT_AUTH_PATHS = new Set([
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey',
  '/passkey/update-passkey'
])

export const librooRecentAuthPlugin = (): BetterAuthPlugin => ({
  id: 'libroo-recent-auth',
  hooks: {
    before: [{
      matcher: context => Boolean(context.path && RECENT_AUTH_PATHS.has(context.path)),
      handler: createAuthMiddleware(async (ctx) => {
        const session = await getSessionFromCtx(ctx)
        const sessionId = session?.session?.id
        if (!sessionId) throw APIError.from('UNAUTHORIZED', { message: 'Unauthorized', code: 'UNAUTHORIZED' })
        try {
          await Effect.runPromise(
            Effect.gen(function* () {
              const recentAuth = yield* RecentAuthService
              return yield* recentAuth.requireRecentAuth(sessionId)
            }).pipe(Effect.provide(RecentAuthServiceLive))
          )
        } catch (error) {
          const message = error instanceof RecentAuthError
            ? error.message
            : 'Unable to verify recent authentication.'
          throw APIError.from('FORBIDDEN', {
            message,
            code: 'RECENT_AUTH_REQUIRED'
          })
        }
      })
    }]
  }
})
