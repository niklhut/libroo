import { afterEach, describe, expect, it, vi } from 'vitest'
import { librooPasskeyTwoFactorPlugin } from '../../server/utils/libroo-passkey-two-factor-plugin'

const { deleteSessionCookie, generateRandomString } = vi.hoisted(() => ({
  deleteSessionCookie: vi.fn(),
  generateRandomString: vi.fn(() => 'challenge')
}))

vi.mock('better-auth/cookies', () => ({ deleteSessionCookie }))
vi.mock('better-auth/crypto', () => ({ generateRandomString }))

describe('librooPasskeyTwoFactorPlugin', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('turns a two-factor user passkey sign-in into a TOTP challenge', async () => {
    const plugin = librooPasskeyTwoFactorPlugin()
    const hook = plugin.hooks?.after?.[0]
    const deleteSession = vi.fn()
    const createVerificationValue = vi.fn()
    const setNewSession = vi.fn()
    const json = vi.fn(value => value)
    const ctx = {
      path: '/passkey/verify-authentication',
      context: {
        newSession: {
          session: { token: 'passkey-session' },
          user: { id: 'user-1', twoFactorEnabled: true }
        },
        internalAdapter: { deleteSession, createVerificationValue },
        createAuthCookie: vi.fn(() => ({ name: 'two_factor', attributes: { httpOnly: true } })),
        setNewSession,
        secret: 'secret'
      },
      json
    }

    expect(hook?.matcher?.(ctx)).toBe(true)
    const handler = hook?.handler as (context: never) => Promise<unknown>
    await expect(handler(ctx as never)).resolves.toEqual({
      twoFactorRedirect: true,
      twoFactorMethods: ['totp']
    })

    expect(deleteSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ path: '/passkey/verify-authentication' }), true)
    expect(deleteSession).toHaveBeenCalledWith('passkey-session')
    expect(setNewSession).toHaveBeenCalledWith(null)
    expect(createVerificationValue).toHaveBeenCalledTimes(2)
    expect(generateRandomString).toHaveBeenCalledWith(20)
  })

  it('leaves passkey sign-in alone when two-factor is not enabled', async () => {
    const plugin = librooPasskeyTwoFactorPlugin()
    const hook = plugin.hooks?.after?.[0]
    const deleteSession = vi.fn()
    const ctx = {
      path: '/passkey/verify-authentication',
      context: {
        newSession: {
          session: { token: 'passkey-session' },
          user: { id: 'user-1', twoFactorEnabled: false }
        },
        internalAdapter: { deleteSession }
      }
    }

    const handler = hook?.handler as (context: never) => Promise<unknown>
    await expect(handler(ctx as never)).resolves.toBeUndefined()
    expect(deleteSessionCookie).not.toHaveBeenCalled()
    expect(deleteSession).not.toHaveBeenCalled()
  })
})
