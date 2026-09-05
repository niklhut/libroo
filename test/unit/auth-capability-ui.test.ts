import { describe, expect, it } from 'vitest'
import { canShowOAuthSignIn, canShowPasskeyManagement, canShowPasskeySignIn, canShowPasswordForm, canShowTwoFactorManagement, getOAuthProviderLabel } from '../../shared/utils/auth-capability-ui'

const capabilityFixture = {
  twoFactorEnabled: true,
  passkeysEnabled: false,
  emailPasswordEnabled: true,
  oauthProvider: null
} as const

describe('auth capability UI predicates', () => {
  it('only exposes passkey UI when the deployment supports it', () => {
    expect(canShowPasskeySignIn({ ...capabilityFixture, passkeysEnabled: false })).toBe(false)
    expect(canShowPasskeySignIn({ ...capabilityFixture, passkeysEnabled: true })).toBe(true)
    expect(canShowPasskeyManagement({ ...capabilityFixture, passkeysEnabled: true })).toBe(true)
    expect(canShowPasskeyManagement({ ...capabilityFixture, passkeysEnabled: false })).toBe(false)
  })

  it('keeps TOTP management independent of passkey availability', () => {
    expect(canShowTwoFactorManagement(capabilityFixture)).toBe(true)
  })

  it('exposes configured OIDC and local-password state independently', () => {
    const oidcFixture = {
      ...capabilityFixture,
      emailPasswordEnabled: false,
      oauthProvider: { enabled: true as const, providerId: 'oidc', displayName: 'Authentik' }
    }
    expect(canShowOAuthSignIn(capabilityFixture)).toBe(false)
    expect(canShowOAuthSignIn(oidcFixture)).toBe(true)
    expect(getOAuthProviderLabel(oidcFixture)).toBe('Continue with Authentik')
    expect(canShowPasswordForm(capabilityFixture)).toBe(true)
    expect(canShowPasswordForm(oidcFixture)).toBe(false)
  })
})
