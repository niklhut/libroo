import { describe, expect, it } from 'vitest'
import { canShowPasskeyManagement, canShowPasskeySignIn, canShowTwoFactorManagement } from '../../shared/utils/auth-capability-ui'

describe('auth capability UI predicates', () => {
  it('only exposes passkey UI when the deployment supports it', () => {
    expect(canShowPasskeySignIn({ twoFactorEnabled: true, passkeysEnabled: false })).toBe(false)
    expect(canShowPasskeyManagement({ twoFactorEnabled: true, passkeysEnabled: true })).toBe(true)
  })

  it('keeps TOTP management independent of passkey availability', () => {
    expect(canShowTwoFactorManagement({ twoFactorEnabled: true, passkeysEnabled: false })).toBe(true)
  })
})
