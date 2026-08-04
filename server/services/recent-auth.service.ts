import { Context, Data, Effect, Layer } from 'effect'
import type { H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { auth } from '../utils/auth'
import { db, schema } from '../runtime/auth-db.active'

export const RECENT_AUTH_TTL_MS = 5 * 60 * 1000

export class RecentAuthError extends Data.TaggedError('RecentAuthError')<{ message: string }> { }

export interface RecentAuthServiceInterface {
  confirmPassword: (event: H3Event, password: string) => Effect.Effect<{ expiresAt: string }, RecentAuthError>
  requireRecentAuth: (sessionId: string) => Effect.Effect<void, RecentAuthError>
  markSessionAsRecentlyAuthenticated: (sessionId: string) => Effect.Effect<void, RecentAuthError>
}

export class RecentAuthService extends Context.Tag('RecentAuthService')<RecentAuthService, RecentAuthServiceInterface>() { }

export const RecentAuthServiceLive = Layer.succeed(RecentAuthService, {
  confirmPassword: (event, password) => Effect.gen(function* () {
    if (!password) return yield* Effect.fail(new RecentAuthError({ message: 'Enter your current password to continue.' }))
    const session = yield* Effect.tryPromise({
      try: () => auth.api.getSession({ headers: event.headers }),
      catch: () => new RecentAuthError({ message: 'You need to sign in again.' })
    })
    if (!session) return yield* Effect.fail(new RecentAuthError({ message: 'You need to sign in again.' }))
    yield* Effect.tryPromise({
      try: () => auth.api.verifyPassword({ headers: event.headers, body: { password } }),
      catch: () => new RecentAuthError({ message: 'Current password is incorrect.' })
    })
    const now = new Date()
    yield* Effect.tryPromise({
      try: () => db.update(schema.session).set({ recentAuthAt: now }).where(eq(schema.session.id, session.session.id)),
      catch: () => new RecentAuthError({ message: 'Unable to confirm your password.' })
    })
    return { expiresAt: new Date(now.getTime() + RECENT_AUTH_TTL_MS).toISOString() }
  }),
  requireRecentAuth: sessionId => Effect.gen(function* () {
    const threshold = new Date(Date.now() - RECENT_AUTH_TTL_MS)
    const record = yield* Effect.tryPromise({
      try: () => db.query.session.findFirst({ where: eq(schema.session.id, sessionId) }),
      catch: () => new RecentAuthError({ message: 'Unable to verify recent authentication.' })
    })
    if (!record?.recentAuthAt || record.recentAuthAt < threshold) {
      return yield* Effect.fail(new RecentAuthError({ message: 'Confirm your password before making this change.' }))
    }
  }),
  markSessionAsRecentlyAuthenticated: sessionId => Effect.tryPromise({
    try: () => db.update(schema.session).set({ recentAuthAt: new Date() }).where(eq(schema.session.id, sessionId)),
    catch: () => new RecentAuthError({ message: 'Unable to preserve recent authentication.' })
  }).pipe(Effect.asVoid)
})
