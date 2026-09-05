import { describe, expect, it, vi } from 'vitest'

import { librooRecentAuthPlugin } from '../../server/utils/libroo-recent-auth-plugin'

vi.mock('../../server/services/recent-auth.service', () => ({
  RecentAuthError: class RecentAuthError extends Error { },
  RecentAuthService: {},
  RecentAuthServiceLive: {}
}))

describe('librooRecentAuthPlugin', () => {
  it('preserves recent authentication when changing a password rotates the session', () => {
    const afterHook = librooRecentAuthPlugin().hooks?.after?.[0]

    expect(afterHook?.matcher?.({ path: '/change-password' })).toBe(true)
  })
})
