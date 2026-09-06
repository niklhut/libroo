import { describe, expect, it } from 'vitest'
import { canShowEmailManagement, canShowOAuthSignIn, canShowPasskeyManagement, canShowPasskeySignIn, canShowPasswordForm, canShowPasswordManagement, canShowTwoFactorManagement, getOAuthProviderLabel } from '../../shared/utils/auth-capability-ui'

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

  it('shows local account security controls only when passwords are enabled', () => {
    expect(canShowTwoFactorManagement(capabilityFixture)).toBe(true)
    expect(canShowEmailManagement(capabilityFixture)).toBe(true)
    const oidcOnlyFixture = { ...capabilityFixture, emailPasswordEnabled: false }
    expect(canShowTwoFactorManagement(oidcOnlyFixture)).toBe(false)
    expect(canShowEmailManagement(oidcOnlyFixture)).toBe(false)
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

  it('shows password management only for users with an enabled credential account', () => {
    expect(canShowPasswordManagement(capabilityFixture, true)).toBe(true)
    expect(canShowPasswordManagement(capabilityFixture, false)).toBe(false)
    expect(canShowPasswordManagement({ ...capabilityFixture, emailPasswordEnabled: false }, true)).toBe(false)
  })
})
