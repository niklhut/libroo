import type { AuthCapabilities } from '~~/shared/types/auth-capabilities'

export function canShowPasskeySignIn(capabilities: AuthCapabilities) {
  return capabilities.passkeysEnabled
}

export function canShowOAuthSignIn(capabilities: AuthCapabilities) {
  return capabilities.oauthProvider?.enabled === true
}

export function getOAuthProviderLabel(capabilities: AuthCapabilities) {
  return capabilities.oauthProvider ? `Continue with ${capabilities.oauthProvider.displayName}` : 'Continue with single sign-on'
}

export function isOAuthProviderLinked(
  capabilities: AuthCapabilities,
  accounts: ReadonlyArray<{ providerId: string }>
) {
  const providerId = capabilities.oauthProvider?.providerId
  return providerId ? accounts.some(account => account.providerId === providerId) : false
}

export function canShowPasswordForm(capabilities: AuthCapabilities) {
  return capabilities.emailPasswordEnabled
}

export function canShowPasskeyManagement(capabilities: AuthCapabilities) {
  return capabilities.passkeysEnabled
}

export function canShowTwoFactorManagement(capabilities: AuthCapabilities) {
  return capabilities.twoFactorEnabled
}
