import { describe, expect, it, vi } from 'vitest'

import { getAuthCapabilities } from '../../server/utils/auth-capabilities'

const { passkeysAvailable } = vi.hoisted(() => ({
  passkeysAvailable: vi.fn()
}))

vi.mock('../../server/utils/webauthn-config', () => ({ passkeysAvailable }))

describe('auth capabilities', () => {
  it('always offers optional TOTP while passing through secure passkey availability', () => {
    passkeysAvailable.mockReturnValue(false)
    expect(getAuthCapabilities()).toEqual({ twoFactorEnabled: true, passkeysEnabled: false })

    passkeysAvailable.mockReturnValue(true)
    expect(getAuthCapabilities()).toEqual({ twoFactorEnabled: true, passkeysEnabled: true })
  })
})
