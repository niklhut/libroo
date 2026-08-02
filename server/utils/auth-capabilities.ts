import type { AuthCapabilities } from '~~/shared/types/auth-capabilities'
import { passkeysAvailable } from './webauthn-config'

export function getAuthCapabilities(): AuthCapabilities {
  return {
    twoFactorEnabled: true,
    passkeysEnabled: passkeysAvailable()
  }
}
