import { booleanConfigValue } from '~~/shared/utils/runtime-config'
import { getConfigValue } from './email-verification-config'
import { getAuthUrl } from './auth'

export interface WebAuthnConfig {
  enabled: boolean
  origin: string
  rpID: string
  secureContext: boolean
}

export function isSecureWebAuthnOrigin(origin: string) {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' || url.hostname === 'localhost'
  } catch {
    return false
  }
}

export function getWebAuthnConfig(): WebAuthnConfig {
  const origin = getAuthUrl()
  let rpID = 'localhost'

  try {
    rpID = new URL(origin).hostname
  } catch {
    // The auth URL helper provides a safe localhost fallback in malformed CLI contexts.
  }

  return {
    enabled: booleanConfigValue(getConfigValue('NUXT_PUBLIC_PASSKEYS_ENABLED', 'public.passkeysEnabled'), false),
    origin,
    rpID,
    secureContext: isSecureWebAuthnOrigin(origin)
  }
}

export function passkeysAvailable(config = getWebAuthnConfig()) {
  return config.enabled && config.secureContext
}
