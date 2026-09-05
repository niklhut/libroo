import { describe, expect, it, vi } from 'vitest'

import { librooRecentAuthPlugin } from '../../server/utils/libroo-recent-auth-plugin'

vi.mock('../../server/services/recent-auth.service', () => ({
  RecentAuthError: class RecentAuthError extends Error { },
  RecentAuthService: {},
  RecentAuthServiceLive: {}
}))

describe('librooRecentAuthPlugin', () => {
  it('preserves recent authentication when changing a password rotates the session', async () => {
    const requireRecentAuth = vi.fn(async () => {})
    const markSessionAsRecentlyAuthenticated = vi.fn(async () => {})
    const plugin = librooRecentAuthPlugin({ requireRecentAuth, markSessionAsRecentlyAuthenticated })
    const beforeHook = plugin.hooks?.before?.[0]
    const afterHook = plugin.hooks?.after?.[0]
    const context = {
      path: '/change-password',
      context: {
        session: { session: { id: 'current-session' } },
        newSession: { session: { id: 'replacement-session' } }
      }
    }

    expect(beforeHook?.matcher?.(context)).toBe(true)
    expect(afterHook?.matcher?.({ path: '/change-password' })).toBe(true)
    await (beforeHook?.handler as (context: unknown) => Promise<void>)(context)
    await (afterHook?.handler as (context: unknown) => Promise<void>)(context)

    expect(requireRecentAuth).toHaveBeenCalledWith('current-session')
    expect(markSessionAsRecentlyAuthenticated).toHaveBeenCalledWith('replacement-session')
  })

  it('marks a successful OIDC callback session as recently authenticated', async () => {
    const requireRecentAuth = vi.fn(async () => {})
    const markSessionAsRecentlyAuthenticated = vi.fn(async () => {})
    const plugin = librooRecentAuthPlugin({ requireRecentAuth, markSessionAsRecentlyAuthenticated })
    const afterHook = plugin.hooks?.after?.[0]
    const context = {
      path: '/callback/oidc',
      context: {
        newSession: { session: { id: 'oidc-session' } }
      }
    }

    expect(afterHook?.matcher?.(context)).toBe(true)
    await (afterHook?.handler as (context: unknown) => Promise<void>)(context)

    expect(requireRecentAuth).not.toHaveBeenCalled()
    expect(markSessionAsRecentlyAuthenticated).toHaveBeenCalledWith('oidc-session')
  })
})
