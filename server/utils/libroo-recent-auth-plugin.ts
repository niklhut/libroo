import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'
import { and, eq, gt } from 'drizzle-orm'
import { db, schema } from '../runtime/auth-db.active'
import { RECENT_AUTH_TTL_MS } from '../services/recent-auth.service'

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
        const recent = await db.query.session.findFirst({
          where: and(
            eq(schema.session.id, sessionId),
            gt(schema.session.recentAuthAt, new Date(Date.now() - RECENT_AUTH_TTL_MS))
          )
        })
        if (!recent) {
          throw APIError.from('FORBIDDEN', {
            message: 'Confirm your password before making this change.',
            code: 'RECENT_AUTH_REQUIRED'
          })
        }
      })
    }]
  }
})
