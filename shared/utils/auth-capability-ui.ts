import type { AuthCapabilities } from '~~/shared/types/auth-capabilities'

export function canShowPasskeySignIn(capabilities: AuthCapabilities) {
  return capabilities.passkeysEnabled
}

export function canShowPasskeyManagement(capabilities: AuthCapabilities) {
  return capabilities.passkeysEnabled
}

export function canShowTwoFactorManagement(capabilities: AuthCapabilities) {
  return capabilities.twoFactorEnabled
}
