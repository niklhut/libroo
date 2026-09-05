import { booleanConfigValue } from '~~/shared/utils/runtime-config'
import { getConfigValue } from './email-verification-config'

export const OIDC_PROVIDER_ID = 'oidc'

export interface OidcProvider {
  providerId: typeof OIDC_PROVIDER_ID
  clientId: string
  clientSecret: string
  discoveryUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  userInfoUrl?: string
  scopes: string[]
  displayName: string
  icon?: string
}

export interface OidcProviderConfig {
  enabled: boolean
  trustProvider: boolean
  emailPasswordEnabled: boolean
  provider: OidcProvider | null
}

function parseScopes(value: string | undefined) {
  return (value ?? 'openid email profile')
    .split(/[\s,]+/)
    .map(scope => scope.trim())
    .filter(Boolean)
}

/**
 * Resolves the optional OIDC deployment settings.  We deliberately disable
 * implicit linking for untrusted providers: an existing account must first
 * explicitly link that provider.  New OIDC users may still be created.
 */
export function getOidcProviderConfig(): OidcProviderConfig {
  const enabled = booleanConfigValue(getConfigValue('NUXT_PUBLIC_OIDC_ENABLED', 'public.oidc.enabled'), false)
  const trustProvider = booleanConfigValue(getConfigValue('NUXT_OIDC_TRUST_PROVIDER', 'oidc.trustProvider'), false)
  const emailPasswordEnabled = booleanConfigValue(getConfigValue('NUXT_EMAIL_PASSWORD_ENABLED', 'emailPasswordEnabled'), true)
  const discoveryUrl = getConfigValue('NUXT_OIDC_DISCOVERY_URL', 'oidc.discoveryUrl')
  const authorizationUrl = getConfigValue('NUXT_OIDC_AUTHORIZATION_URL', 'oidc.authorizationUrl')
  const tokenUrl = getConfigValue('NUXT_OIDC_TOKEN_URL', 'oidc.tokenUrl')
  const userInfoUrl = getConfigValue('NUXT_OIDC_USER_INFO_URL', 'oidc.userInfoUrl')
  const clientId = getConfigValue('NUXT_OIDC_CLIENT_ID', 'oidc.clientId')
  const clientSecret = getConfigValue('NUXT_OIDC_CLIENT_SECRET', 'oidc.clientSecret')
  const explicitUrlsConfigured = Boolean(authorizationUrl && tokenUrl && userInfoUrl)

  return {
    enabled,
    trustProvider,
    emailPasswordEnabled,
    provider: clientId && clientSecret && (discoveryUrl || explicitUrlsConfigured)
      ? {
          providerId: OIDC_PROVIDER_ID,
          clientId,
          clientSecret,
          discoveryUrl,
          authorizationUrl: discoveryUrl ? undefined : authorizationUrl,
          tokenUrl: discoveryUrl ? undefined : tokenUrl,
          userInfoUrl: discoveryUrl ? undefined : userInfoUrl,
          scopes: parseScopes(getConfigValue('NUXT_OIDC_SCOPES', 'oidc.scopes')),
          displayName: getConfigValue('NUXT_PUBLIC_OIDC_DISPLAY_NAME', 'public.oidc.displayName') ?? 'Single sign-on',
          icon: getConfigValue('NUXT_PUBLIC_OIDC_ICON', 'public.oidc.icon')
        }
      : null
  }
}

export function oidcProviderConfigured(config = getOidcProviderConfig()) {
  return config.enabled && config.provider !== null
}

export function validateOidcProviderConfig(config = getOidcProviderConfig()) {
  if (!config.enabled || config.provider) return

  const missing: string[] = []
  if (!getConfigValue('NUXT_OIDC_CLIENT_ID', 'oidc.clientId')) missing.push('NUXT_OIDC_CLIENT_ID')
  if (!getConfigValue('NUXT_OIDC_CLIENT_SECRET', 'oidc.clientSecret')) missing.push('NUXT_OIDC_CLIENT_SECRET')

  const discoveryUrl = getConfigValue('NUXT_OIDC_DISCOVERY_URL', 'oidc.discoveryUrl')
  const authorizationUrl = getConfigValue('NUXT_OIDC_AUTHORIZATION_URL', 'oidc.authorizationUrl')
  const tokenUrl = getConfigValue('NUXT_OIDC_TOKEN_URL', 'oidc.tokenUrl')
  const userInfoUrl = getConfigValue('NUXT_OIDC_USER_INFO_URL', 'oidc.userInfoUrl')
  if (!discoveryUrl) {
    if (!authorizationUrl) missing.push('NUXT_OIDC_AUTHORIZATION_URL')
    if (!tokenUrl) missing.push('NUXT_OIDC_TOKEN_URL')
    if (!userInfoUrl) missing.push('NUXT_OIDC_USER_INFO_URL')
    if (!authorizationUrl || !tokenUrl || !userInfoUrl) {
      missing.push('NUXT_OIDC_DISCOVERY_URL (or all explicit endpoint URLs)')
    }
  }

  throw new Error(`OIDC is enabled, but configuration is incomplete. Missing: ${missing.join(', ')}.`)
}

export function getOidcAccountLinkingOptions(config = getOidcProviderConfig()) {
  const providerId = config.provider?.providerId ?? OIDC_PROVIDER_ID
  return {
    enabled: true,
    allowDifferentEmails: false,
    trustedProviders: config.trustProvider ? [providerId] : [],
    disableImplicitLinking: !config.trustProvider
  }
}
