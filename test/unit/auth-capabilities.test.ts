import { describe, expect, it, vi } from 'vitest'

import { getAuthCapabilities } from '../../server/utils/auth-capabilities'

const { getOidcProviderConfig, oidcProviderConfigured, passkeysAvailable } = vi.hoisted(() => ({
  getOidcProviderConfig: vi.fn(),
  oidcProviderConfigured: vi.fn(),
  passkeysAvailable: vi.fn()
}))

vi.mock('../../server/utils/webauthn-config', () => ({ passkeysAvailable }))
vi.mock('../../server/utils/oidc-provider-config', () => ({ getOidcProviderConfig, oidcProviderConfigured }))

describe('auth capabilities', () => {
  it('always offers optional TOTP while passing through secure passkey availability', () => {
    passkeysAvailable.mockReturnValue(false)
    getOidcProviderConfig.mockReturnValue({ emailPasswordEnabled: true, provider: null })
    oidcProviderConfigured.mockReturnValue(false)
    expect(getAuthCapabilities()).toEqual({
      twoFactorEnabled: true,
      passkeysEnabled: false,
      emailPasswordEnabled: true,
      oauthProvider: null
    })

    passkeysAvailable.mockReturnValue(true)
    getOidcProviderConfig.mockReturnValue({
      emailPasswordEnabled: false,
      provider: { providerId: 'oidc', displayName: 'Authentik', icon: 'i-simple-icons-authentik' }
    })
    oidcProviderConfigured.mockReturnValue(true)
    expect(getAuthCapabilities()).toEqual({
      twoFactorEnabled: true,
      passkeysEnabled: true,
      emailPasswordEnabled: false,
      oauthProvider: {
        enabled: true,
        providerId: 'oidc',
        displayName: 'Authentik',
        icon: 'i-simple-icons-authentik'
      }
    })
  })
})
