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
const RECENT_AUTH_SESSION_ROTATION_PATHS = new Set([
  '/two-factor/disable',
  '/two-factor/verify-totp'
])
const RECENT_AUTH_SESSION_ROTATION_FLAG = '__librooRecentAuthSessionRotation'

type RecentAuthContext = {
  newSession?: { session: { id: string } } | null
  [RECENT_AUTH_SESSION_ROTATION_FLAG]?: boolean
}

export const librooRecentAuthPlugin = (): BetterAuthPlugin => ({
  id: 'libroo-recent-auth',
  hooks: {
    before: [{
      matcher: context => Boolean(context.path && RECENT_AUTH_PATHS.has(context.path)),
      handler: createAuthMiddleware(async (ctx) => {
        const session = await getSessionFromCtx(ctx)
        const sessionId = session?.session?.id
        if (!sessionId) throw APIError.from('UNAUTHORIZED', { message: 'Unauthorized', code: 'UNAUTHORIZED' })
        await requireRecentAuth(sessionId)
        if (ctx.path && RECENT_AUTH_SESSION_ROTATION_PATHS.has(ctx.path)) {
          ;(ctx.context as RecentAuthContext)[RECENT_AUTH_SESSION_ROTATION_FLAG] = true
        }
      })
    }, {
      // Setup verification creates a replacement session only for an existing
      // signed-in user. Sign-in verification has no session and deliberately
      // does not receive a recent-auth marker.
      matcher: context => context.path === '/two-factor/verify-totp',
      handler: createAuthMiddleware(async (ctx) => {
        const sessionId = (await getSessionFromCtx(ctx))?.session?.id
        if (!sessionId) return
        await requireRecentAuth(sessionId)
        ;(ctx.context as RecentAuthContext)[RECENT_AUTH_SESSION_ROTATION_FLAG] = true
      })
    }],
    after: [{
      matcher: context => Boolean(context.path && RECENT_AUTH_SESSION_ROTATION_PATHS.has(context.path)),
      handler: createAuthMiddleware(async (ctx) => {
        const context = ctx.context as RecentAuthContext
        if (!context[RECENT_AUTH_SESSION_ROTATION_FLAG]) return
        context[RECENT_AUTH_SESSION_ROTATION_FLAG] = false
        const replacementSessionId = context.newSession?.session.id
        if (!replacementSessionId) return

        try {
          await Effect.runPromise(
            Effect.gen(function* () {
              const recentAuth = yield* RecentAuthService
              return yield* recentAuth.markSessionAsRecentlyAuthenticated(replacementSessionId)
            }).pipe(Effect.provide(RecentAuthServiceLive))
          )
        } catch {
          // Do not turn a completed security change into an error. A missing
          // marker simply asks the user to confirm their password again.
        }
      })
    }]
  }
})

async function requireRecentAuth(sessionId: string) {
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
}
