import type { AuthCapabilities } from '~~/shared/types/auth-capabilities'
import { passkeysAvailable } from './webauthn-config'
import { getOidcProviderConfig, oidcProviderConfigured } from './oidc-provider-config'

export function getAuthCapabilities(): AuthCapabilities {
  const oidcConfig = getOidcProviderConfig()
  const provider = oidcConfig.provider
  return {
    twoFactorEnabled: true,
    passkeysEnabled: passkeysAvailable(),
    emailPasswordEnabled: oidcConfig.emailPasswordEnabled,
    oauthProvider: oidcProviderConfigured(oidcConfig) && provider
      ? {
          enabled: true,
          providerId: provider.providerId,
          displayName: provider.displayName,
          ...(provider.icon ? { icon: provider.icon } : {})
        }
      : null
  }
}
