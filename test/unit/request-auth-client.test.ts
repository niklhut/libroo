import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequestAuthClient } from '../../app/composables/useAuth'

describe('request-scoped auth client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('restores an SSR session by forwarding the incoming cookie and origin', async () => {
    const session = {
      user: {
        id: 'u1',
        email: 'ada@example.com',
        emailVerified: true,
        role: 'user'
      },
      session: {
        id: 's1'
      }
    }
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)

      expect(request.url).toBe('https://app.libroo.app/api/auth/get-session')
      expect(request.headers.get('cookie')).toBe('better-auth.session_token=signed-cookie')
      expect(request.headers.get('origin')).toBe('https://app.libroo.app')

      return Response.json(session)
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = createRequestAuthClient('https://app.libroo.app', {
      cookie: 'better-auth.session_token=signed-cookie'
    })

    await expect(client.getSession()).resolves.toMatchObject({
      data: session,
      error: null
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
