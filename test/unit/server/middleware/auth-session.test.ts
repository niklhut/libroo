import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMock = vi.hoisted(() => ({
  getSession: vi.fn()
}))

const loggerMock = vi.hoisted(() => ({
  logAuthSessionResolution: vi.fn()
}))

vi.mock('../../../../server/utils/auth', () => ({
  auth: {
    api: {
      getSession: authMock.getSession
    }
  }
}))

vi.mock('../../../../server/utils/auth-session-logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../server/utils/auth-session-logger')>()
  return {
    ...actual,
    logAuthSessionResolution: loggerMock.logAuthSessionResolution
  }
})

describe('server/middleware/auth-session', () => {
  beforeEach(() => {
    authMock.getSession.mockReset()
    loggerMock.logAuthSessionResolution.mockReset()
  })

  it('stores authenticated sessions on the request context', async () => {
    const session = {
      user: { id: 'user-1' },
      session: { id: 'session-1' }
    }
    authMock.getSession.mockResolvedValueOnce(session)
    const event = makeEvent('/library')

    await runMiddleware(event)

    expect(authMock.getSession).toHaveBeenCalledWith({ headers: event.headers })
    expect(event.context.authSession).toEqual({
      status: 'authenticated',
      session
    })
    expect(loggerMock.logAuthSessionResolution).toHaveBeenCalledWith({
      event,
      outcome: 'success'
    })
  })

  it('stores unauthenticated results on the request context', async () => {
    authMock.getSession.mockResolvedValueOnce(null)
    const event = makeEvent('/library')

    await runMiddleware(event)

    expect(event.context.authSession).toEqual({
      status: 'unauthenticated',
      session: null
    })
    expect(loggerMock.logAuthSessionResolution).toHaveBeenCalledWith({
      event,
      outcome: 'unauthenticated'
    })
  })

  it('stores lookup failures separately from signed-out sessions', async () => {
    authMock.getSession.mockRejectedValueOnce(Object.assign(new Error('database offline'), {
      statusCode: 503
    }))
    const event = makeEvent('/library')

    await runMiddleware(event)

    expect(event.context.authSession).toEqual({
      status: 'error',
      session: null,
      error: {
        name: 'Error',
        message: 'database offline',
        status: 503
      }
    })
    expect(loggerMock.logAuthSessionResolution).toHaveBeenCalledWith({
      event,
      outcome: 'failure',
      error: expect.any(Error)
    })
  })

  it('skips API and asset requests', async () => {
    const event = makeEvent('/api/books')

    await runMiddleware(event)

    expect(authMock.getSession).not.toHaveBeenCalled()
    expect(event.context.authSession).toEqual({
      status: 'unauthenticated',
      session: null
    })
    expect(loggerMock.logAuthSessionResolution).toHaveBeenCalledWith({
      event,
      outcome: 'skipped',
      reason: 'non-document-request'
    })
  })

  it('skips wildcard accept requests without a document fetch destination', async () => {
    const event = makeEvent('/library', {
      accept: '*/*'
    })

    await runMiddleware(event)

    expect(authMock.getSession).not.toHaveBeenCalled()
    expect(loggerMock.logAuthSessionResolution).toHaveBeenCalledWith({
      event,
      outcome: 'skipped',
      reason: 'non-document-request'
    })
  })

  it('allows wildcard accept requests with a document fetch destination', async () => {
    authMock.getSession.mockResolvedValueOnce(null)
    const event = makeEvent('/library', {
      'accept': '*/*',
      'sec-fetch-dest': 'document'
    })

    await runMiddleware(event)

    expect(authMock.getSession).toHaveBeenCalledWith({ headers: event.headers })
    expect(event.context.authSession).toEqual({
      status: 'unauthenticated',
      session: null
    })
  })
})

async function runMiddleware(event: ReturnType<typeof makeEvent>) {
  const middleware = await import('../../../../server/middleware/auth-session')
  await middleware.default(event as never)
}

function makeEvent(path: string, headers: Record<string, string> = { accept: 'text/html' }) {
  return {
    method: 'GET',
    path,
    headers: new Headers(headers),
    context: {},
    node: {
      req: {
        url: path
      }
    }
  }
}
