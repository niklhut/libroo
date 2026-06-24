import { Effect } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthSessionRepository,
  AuthSessionRepositoryError,
  AuthSessionRepositoryLive
} from '../../../../server/repositories/auth-session.repository'

const authMock = vi.hoisted(() => ({
  getSession: vi.fn()
}))

vi.mock('../../../../server/utils/auth', () => ({
  auth: {
    api: {
      getSession: authMock.getSession
    }
  }
}))

describe('AuthSessionRepository', () => {
  beforeEach(() => {
    authMock.getSession.mockReset()
  })

  it('resolves the session directly from the incoming request headers', async () => {
    const headers = new Headers({
      cookie: 'better-auth.session_token=signed-cookie'
    })
    const session = {
      user: { id: 'user-1' },
      session: { id: 'session-1' }
    }
    authMock.getSession.mockResolvedValueOnce(session)

    const result = await runRepository(
      Effect.flatMap(AuthSessionRepository, repository => repository.getSession(headers))
    )

    expect(result).toBe(session)
    expect(authMock.getSession).toHaveBeenCalledWith({ headers })
  })

  it('preserves useful infrastructure error details', async () => {
    const cause = new Error('D1 binding unavailable')
    authMock.getSession.mockRejectedValueOnce({
      message: 'Session lookup failed',
      status: 503,
      code: 'D1_UNAVAILABLE',
      cause
    })

    const result = await runRepository(Effect.either(
      Effect.flatMap(
        AuthSessionRepository,
        repository => repository.getSession(new Headers())
      )
    ))

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(AuthSessionRepositoryError)
    expect(result.left).toMatchObject({
      message: 'Session lookup failed',
      status: 503,
      code: 'D1_UNAVAILABLE',
      cause
    })
  })
})

function runRepository<A, E>(effect: Effect.Effect<A, E, AuthSessionRepository>) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(AuthSessionRepositoryLive)
  ))
}
