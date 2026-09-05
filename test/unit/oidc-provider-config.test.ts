import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOidcProviderConfig, oidcProviderConfigured, validateOidcProviderConfig } from '../../server/utils/oidc-provider-config'

const envKeys = [
  'NUXT_PUBLIC_OIDC_ENABLED', 'NUXT_OIDC_DISCOVERY_URL', 'NUXT_OIDC_AUTHORIZATION_URL',
  'NUXT_OIDC_TOKEN_URL', 'NUXT_OIDC_USER_INFO_URL', 'NUXT_OIDC_CLIENT_ID',
  'NUXT_OIDC_CLIENT_SECRET', 'NUXT_OIDC_SCOPES', 'NUXT_PUBLIC_OIDC_DISPLAY_NAME',
  'NUXT_PUBLIC_OIDC_ICON', 'NUXT_OIDC_TRUST_PROVIDER', 'NUXT_EMAIL_PASSWORD_ENABLED'
]
const originalEnv = new Map(envKeys.map(key => [key, process.env[key]]))

describe('OIDC provider config', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    for (const key of envKeys) {
      const value = originalEnv.get(key)
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    }
  })

  it('prefers discovery and parses scopes, public labels, and defaults', () => {
    process.env.NUXT_PUBLIC_OIDC_ENABLED = 'true'
    process.env.NUXT_OIDC_DISCOVERY_URL = 'https://id.example.com/.well-known/openid-configuration'
    process.env.NUXT_OIDC_CLIENT_ID = 'client'
    process.env.NUXT_OIDC_CLIENT_SECRET = 'secret'
    process.env.NUXT_OIDC_SCOPES = 'openid, email profile groups'
    process.env.NUXT_PUBLIC_OIDC_DISPLAY_NAME = 'Authentik'

    expect(getOidcProviderConfig()).toMatchObject({
      enabled: true,
      trustProvider: false,
      emailPasswordEnabled: true,
      provider: {
        providerId: 'oidc',
        discoveryUrl: 'https://id.example.com/.well-known/openid-configuration',
        scopes: ['openid', 'email', 'profile', 'groups'],
        displayName: 'Authentik'
      }
    })
  })

  it('uses explicit endpoint URLs and runtime config values when discovery is absent', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      oidc: {
        authorizationUrl: 'https://id.example.com/authorize',
        tokenUrl: 'https://id.example.com/token',
        userInfoUrl: 'https://id.example.com/userinfo',
        clientId: 'runtime-client',
        clientSecret: 'runtime-secret'
      },
      public: { oidc: { enabled: 'true', icon: 'i-lucide-building' } },
      emailPasswordEnabled: 'false'
    }))

    expect(getOidcProviderConfig()).toMatchObject({
      enabled: true,
      emailPasswordEnabled: false,
      provider: {
        authorizationUrl: 'https://id.example.com/authorize',
        tokenUrl: 'https://id.example.com/token',
        userInfoUrl: 'https://id.example.com/userinfo',
        clientId: 'runtime-client',
        icon: 'i-lucide-building',
        scopes: ['openid', 'email', 'profile']
      }
    })
  })

  it('reports disabled and enabled-but-incomplete provider states', () => {
    expect(oidcProviderConfigured()).toBe(false)
    process.env.NUXT_PUBLIC_OIDC_ENABLED = 'true'
    expect(oidcProviderConfigured()).toBe(false)
    expect(() => validateOidcProviderConfig()).toThrow(/NUXT_OIDC_CLIENT_ID, NUXT_OIDC_CLIENT_SECRET/)
    expect(() => validateOidcProviderConfig()).toThrow(/NUXT_OIDC_DISCOVERY_URL \(or all explicit endpoint URLs\)/)
  })
})
