import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_SESSION_OUTCOMES,
  logAuthSessionResolution,
  summarizeAuthSessionError
} from '../../../../server/utils/auth-session-logger'

describe('auth session logger', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exports stable outcome identifiers', () => {
    expect(AUTH_SESSION_OUTCOMES).toEqual({
      success: 'success',
      unauthenticated: 'unauthenticated',
      failure: 'failure',
      skipped: 'skipped'
    })
  })

  it('logs only safe request metadata', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const event = makeEvent({
      path: '/library',
      headers: new Headers({
        cookie: 'better-auth.session_token=secret',
        authorization: 'Bearer token'
      }),
      context: {
        requestId: 'req-1'
      }
    })

    logAuthSessionResolution({
      event,
      outcome: AUTH_SESSION_OUTCOMES.success
    })

    expect(info).toHaveBeenCalledWith({
      component: 'auth-session',
      outcome: 'success',
      requestId: 'req-1',
      path: '/library'
    })
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret')
    expect(JSON.stringify(info.mock.calls)).not.toContain('authorization')
  })

  it('redacts sensitive values from failure errors and causes', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const cause = new Error('token abc for ada@example.com')
    const error = Object.assign(new Error('cookie leaked for ada@example.com'), {
      statusCode: 503,
      cause
    })

    logAuthSessionResolution({
      event: makeEvent({ path: '/library' }),
      outcome: AUTH_SESSION_OUTCOMES.failure,
      error
    })

    const payload = warn.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload.error).toEqual({
      name: 'Error',
      message: '[redacted-secret] leaked for [redacted-email]',
      status: 503,
      cause: 'Error: [redacted-secret] abc for [redacted-email]'
    })
    expect(JSON.stringify(payload)).not.toContain('ada@example.com')
    expect(JSON.stringify(payload)).not.toContain('cookie')
  })

  it('summarizes non-error failures safely', () => {
    expect(summarizeAuthSessionError({ name: 'AuthApiError', message: 'Bearer token', status: 401 })).toEqual({
      name: 'AuthApiError',
      message: '[redacted-secret] [redacted-secret]',
      status: 401
    })
  })
})

function makeEvent(options: { path: string, headers?: Headers, context?: Record<string, unknown> }) {
  return {
    path: options.path,
    headers: options.headers ?? new Headers(),
    context: options.context ?? {},
    node: {
      req: {
        url: options.path
      }
    }
  } as never
}
