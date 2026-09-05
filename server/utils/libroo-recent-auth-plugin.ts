import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'
import { Effect } from 'effect'
import { RecentAuthError, RecentAuthService, RecentAuthServiceLive } from '../services/recent-auth.service'

const RECENT_AUTH_PATHS = new Set([
  '/change-password',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey',
  '/passkey/update-passkey'
])
const RECENT_AUTH_SESSION_ROTATION_PATHS = new Set([
  // Better Auth replaces the current session when changePassword is called
  // with revokeOtherSessions. Preserve the fresh-password confirmation on
  // that replacement so a following security action (for example 2FA setup)
  // does not see a stale client-side recent-auth state.
  '/change-password',
  '/two-factor/disable',
  '/two-factor/verify-totp'
])
const RECENT_AUTH_SESSION_ROTATION_FLAG = '__librooRecentAuthSessionRotation'
const OIDC_CALLBACK_PATH = '/callback/oidc'

type RecentAuthContext = {
  newSession?: { session: { id: string } } | null
  [RECENT_AUTH_SESSION_ROTATION_FLAG]?: boolean
}

interface RecentAuthOperations {
  requireRecentAuth: (sessionId: string) => Promise<void>
  markSessionAsRecentlyAuthenticated: (sessionId: string) => Promise<void>
}

const defaultRecentAuthOperations: RecentAuthOperations = {
  requireRecentAuth,
  markSessionAsRecentlyAuthenticated
}

export const librooRecentAuthPlugin = (
  operations: RecentAuthOperations = defaultRecentAuthOperations
): BetterAuthPlugin => ({
  id: 'libroo-recent-auth',
  hooks: {
    before: [{
      matcher: context => Boolean(context.path && RECENT_AUTH_PATHS.has(context.path)),
      handler: createAuthMiddleware(async (ctx) => {
        const session = await getSessionFromCtx(ctx)
        const sessionId = session?.session?.id
        if (!sessionId) throw APIError.from('UNAUTHORIZED', { message: 'Unauthorized', code: 'UNAUTHORIZED' })
        await operations.requireRecentAuth(sessionId)
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
        await operations.requireRecentAuth(sessionId)
        ;(ctx.context as RecentAuthContext)[RECENT_AUTH_SESSION_ROTATION_FLAG] = true
      })
    }],
    after: [{
      matcher: context => Boolean(context.path && (
        RECENT_AUTH_SESSION_ROTATION_PATHS.has(context.path) || context.path === OIDC_CALLBACK_PATH
      )),
      handler: createAuthMiddleware(async (ctx) => {
        const context = ctx.context as RecentAuthContext
        const isOidcCallback = ctx.path === OIDC_CALLBACK_PATH
        if (!isOidcCallback && !context[RECENT_AUTH_SESSION_ROTATION_FLAG]) return
        if (!isOidcCallback) context[RECENT_AUTH_SESSION_ROTATION_FLAG] = false
        const replacementSessionId = context.newSession?.session.id
        if (!replacementSessionId) return

        try {
          await operations.markSessionAsRecentlyAuthenticated(replacementSessionId)
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

async function markSessionAsRecentlyAuthenticated(sessionId: string) {
  await Effect.runPromise(
    Effect.gen(function* () {
      const recentAuth = yield* RecentAuthService
      return yield* recentAuth.markSessionAsRecentlyAuthenticated(sessionId)
    }).pipe(Effect.provide(RecentAuthServiceLive))
  )
}
