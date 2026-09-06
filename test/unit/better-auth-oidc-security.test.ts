import { afterEach, describe, expect, it, vi } from 'vitest'
import { genericOAuth } from 'better-auth/plugins'

const discoveryUrl = 'https://id.example.com/.well-known/openid-configuration'

function createPlugin() {
  return genericOAuth({
    config: [{
      providerId: 'oidc',
      clientId: 'client',
      clientSecret: 'secret',
      discoveryUrl,
      scopes: ['openid', 'email', 'profile']
    }]
  })
}

function pluginContext() {
  return {
    baseURL: 'https://libroo.example.com/api/auth',
    socialProviders: [],
    logger: {
      error: vi.fn(),
      warn: vi.fn()
    }
  }
}

describe('Better Auth OIDC transport hardening patch', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('refuses redirects for discovery and bearer-token user-info requests', async () => {
    const requests: Array<{ input: RequestInfo | URL, init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input, init })
      if (requests.length === 1) {
        return Response.json({
          issuer: 'https://id.example.com',
          authorization_endpoint: 'https://id.example.com/authorize',
          token_endpoint: 'https://id.example.com/token',
          userinfo_endpoint: 'https://id.example.com/userinfo'
        })
      }
      return Response.json({
        sub: 'user-id',
        email: 'user@example.com',
        email_verified: true,
        name: 'Example User'
      })
    }))

    const initialized = await createPlugin().init?.(pluginContext() as never)
    const provider = (initialized as { context: { socialProviders: Array<{ getUserInfo: (tokens: unknown) => Promise<unknown> }> } })
      .context.socialProviders[0]
    await provider?.getUserInfo({ accessToken: 'access-token' })

    expect(requests).toHaveLength(2)
    expect(requests[0]?.init?.redirect).toBe('manual')
    expect(requests[1]?.init?.redirect).toBe('manual')
    expect(new Headers(requests[1]?.init?.headers).get('authorization')).toBe('Bearer access-token')
  })

  it('rejects an insecure endpoint returned by discovery', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      issuer: 'https://id.example.com',
      authorization_endpoint: 'https://id.example.com/authorize',
      token_endpoint: 'https://id.example.com/token',
      userinfo_endpoint: 'http://metadata.internal/userinfo'
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(createPlugin().init?.(pluginContext() as never))
      .rejects.toThrow(/discovery returned no valid data/)
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
