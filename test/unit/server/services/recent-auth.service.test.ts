import { Effect } from 'effect'
import type { H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RECENT_AUTH_TTL_MS, verifyPasswordOrRequireRecentAuth } from '../../../../server/services/recent-auth.service'

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  verifyPassword: vi.fn()
}))
const dbMock = vi.hoisted(() => ({
  findSession: vi.fn()
}))

vi.mock('../../../../server/utils/auth', () => ({
  auth: {
    api: {
      getSession: authMock.getSession,
      verifyPassword: authMock.verifyPassword
    }
  }
}))

vi.mock('../../../../server/runtime/auth-db.active', async () => {
  const schema = await import('../../../../server/db/schema')
  return {
    schema,
    db: {
      query: {
        session: { findFirst: dbMock.findSession }
      }
    }
  }
})

describe('verifyPasswordOrRequireRecentAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.verifyPassword.mockResolvedValue({ status: true })
  })

  it('preserves current-password verification for password accounts', async () => {
    const event = makeEvent()

    await expect(Effect.runPromise(
      verifyPasswordOrRequireRecentAuth(event, 'current-password')
    )).resolves.toBeUndefined()

    expect(authMock.verifyPassword).toHaveBeenCalledWith({
      headers: event.headers,
      body: { password: 'current-password' }
    })
    expect(authMock.getSession).not.toHaveBeenCalled()
  })

  it('accepts a recent OIDC session when no password is available', async () => {
    authMock.getSession.mockResolvedValue({ session: { id: 'oidc-session' } })
    dbMock.findSession.mockResolvedValue({ recentAuthAt: new Date() })

    await expect(Effect.runPromise(
      verifyPasswordOrRequireRecentAuth(makeEvent(), '')
    )).resolves.toBeUndefined()

    expect(dbMock.findSession).toHaveBeenCalledTimes(1)
  })

  it('rejects an expired OIDC reauthentication marker', async () => {
    authMock.getSession.mockResolvedValue({ session: { id: 'oidc-session' } })
    dbMock.findSession.mockResolvedValue({
      recentAuthAt: new Date(Date.now() - RECENT_AUTH_TTL_MS - 1)
    })

    await expect(Effect.runPromise(
      verifyPasswordOrRequireRecentAuth(makeEvent(), '')
    )).rejects.toThrow('Sign in again before making this change.')
  })
})

function makeEvent() {
  return { headers: new Headers() } as H3Event
}
