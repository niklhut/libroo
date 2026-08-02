import { createAuthMiddleware } from 'better-auth/api'
import { deleteSessionCookie } from 'better-auth/cookies'
import { generateRandomString } from 'better-auth/crypto'
import type { BetterAuthPlugin } from 'better-auth/types'

const PASSKEY_AUTHENTICATION_PATH = '/passkey/verify-authentication'
const TWO_FACTOR_COOKIE_NAME = 'two_factor'
const TWO_FACTOR_CHALLENGE_MAX_AGE = 10 * 60

interface NewSession {
  session: { token: string }
  user: { id: string, twoFactorEnabled?: boolean }
}

/**
 * Better Auth's two-factor plugin only intercepts password-based sign-ins.
 * Passkey authentication creates its own session, so mirror that challenge
 * hand-off here before the passkey session can be used.
 */
export const librooPasskeyTwoFactorPlugin = (): BetterAuthPlugin => ({
  id: 'libroo-passkey-two-factor',
  hooks: {
    after: [{
      matcher: context => context.path === PASSKEY_AUTHENTICATION_PATH,
      handler: createAuthMiddleware(async (ctx) => {
        const newSession = ctx.context.newSession as NewSession | null
        if (!newSession?.user.twoFactorEnabled) return

        deleteSessionCookie(ctx, true)
        await ctx.context.internalAdapter.deleteSession(newSession.session.token)
        ctx.context.setNewSession(null)

        const twoFactorCookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME, {
          maxAge: TWO_FACTOR_CHALLENGE_MAX_AGE
        })
        const identifier = `2fa-${generateRandomString(20)}`
        const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_MAX_AGE * 1000)

        await ctx.context.internalAdapter.createVerificationValue({
          value: newSession.user.id,
          identifier,
          expiresAt
        })
        await ctx.context.internalAdapter.createVerificationValue({
          value: '0',
          identifier: `2fa-attempts-${identifier}`,
          expiresAt
        })
        await ctx.setSignedCookie(twoFactorCookie.name, identifier, ctx.context.secret, twoFactorCookie.attributes)

        return ctx.json({
          twoFactorRedirect: true,
          twoFactorMethods: ['totp']
        })
      })
    }]
  }
})
