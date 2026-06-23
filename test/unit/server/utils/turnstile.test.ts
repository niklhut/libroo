import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTurnstileCaptchaPlugins, getTurnstileProtectionConfig } from '../../../../server/utils/turnstile'

const originalEnv = { ...process.env }

const authContext = {
  options: {
    basePath: '/api/auth'
  },
  logger: {
    error: vi.fn()
  }
}

function protectedRequest(endpoint: string, token?: string) {
  return new Request(`https://libroo.example.com/api/auth${endpoint}`, {
    method: 'POST',
    headers: token
      ? {
          'x-captcha-response': token
        }
      : undefined
  })
}

function installTurnstileFetch(success: boolean) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success }), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  }))

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Turnstile protection config', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
  })

  it('is disabled by default for local development and private self-hosted installs', () => {
    delete process.env.NUXT_PUBLIC_TURNSTILE_ENABLED
    delete process.env.NUXT_TURNSTILE_SECRET_KEY

    expect(getTurnstileProtectionConfig()).toEqual({
      enabled: false,
      secretKey: '',
      siteVerifyURLOverride: undefined,
      allowedHostnames: []
    })
    expect(createTurnstileCaptchaPlugins()).toEqual([])
  })

  it('reads operator-controlled environment configuration', () => {
    process.env.NUXT_PUBLIC_TURNSTILE_ENABLED = 'true'
    process.env.NUXT_TURNSTILE_SECRET_KEY = 'secret'
    process.env.NUXT_TURNSTILE_ALLOWED_HOSTNAMES = 'libroo.example.com, beta.libroo.example.com'

    expect(getTurnstileProtectionConfig()).toMatchObject({
      enabled: true,
      secretKey: 'secret',
      allowedHostnames: ['libroo.example.com', 'beta.libroo.example.com']
    })
  })
})

describe('Turnstile Better Auth captcha plugin', () => {
  const config = {
    enabled: true,
    secretKey: 'turnstile-secret',
    siteVerifyURLOverride: 'https://turnstile.test/siteverify',
    allowedHostnames: []
  }

  beforeEach(() => {
    vi.unstubAllGlobals()
    authContext.logger.error.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  for (const endpoint of ['/sign-up/email', '/request-password-reset']) {
    it(`fails ${endpoint} when the token is missing`, async () => {
      const [plugin] = createTurnstileCaptchaPlugins(config)
      const response = await plugin.onRequest(protectedRequest(endpoint), authContext as never)

      expect(response?.response.status).toBe(400)
      expect(await response?.response.json()).toMatchObject({
        code: 'MISSING_RESPONSE'
      })
    })

    it(`allows ${endpoint} when Turnstile accepts the token`, async () => {
      const fetchMock = installTurnstileFetch(true)
      const [plugin] = createTurnstileCaptchaPlugins(config)

      await expect(plugin.onRequest(protectedRequest(endpoint, 'valid-token'), authContext as never)).resolves.toBeUndefined()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://turnstile.test/siteverify')
      expect(String(fetchMock.mock.calls[0]?.[1]?.body)).toContain('"response":"valid-token"')
    })

    it(`fails ${endpoint} when Turnstile rejects the token`, async () => {
      installTurnstileFetch(false)
      const [plugin] = createTurnstileCaptchaPlugins(config)
      const response = await plugin.onRequest(protectedRequest(endpoint, 'invalid-token'), authContext as never)

      expect(response?.response.status).toBe(403)
      expect(await response?.response.json()).toMatchObject({
        code: 'VERIFICATION_FAILED'
      })
    })
  }

  it('leaves login unaffected in this sprint', async () => {
    const fetchMock = installTurnstileFetch(true)
    const [plugin] = createTurnstileCaptchaPlugins(config)

    await expect(plugin.onRequest(protectedRequest('/sign-in/email'), authContext as never)).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
