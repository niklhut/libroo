import { captcha } from 'better-auth/plugins'
import { booleanConfigValue } from '~~/shared/utils/runtime-config'

const TURNSTILE_ENDPOINTS = [
  '/sign-up/email',
  '/request-password-reset'
]

export interface TurnstileProtectionConfig {
  enabled: boolean
  secretKey: string
  siteVerifyURLOverride?: string
  allowedHostnames: string[]
}

function stringConfigValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

function csvConfigValue(value: unknown) {
  return stringConfigValue(value)
    .split(',')
    .map(hostname => hostname.trim())
    .filter(Boolean)
}

export function getTurnstileProtectionConfig(): TurnstileProtectionConfig {
  const envEnabled = process.env.NUXT_PUBLIC_TURNSTILE_ENABLED
  const envSecretKey = process.env.NUXT_TURNSTILE_SECRET_KEY
  const envSiteVerifyURLOverride = process.env.NUXT_TURNSTILE_SITE_VERIFY_URL
  const envAllowedHostnames = process.env.NUXT_TURNSTILE_ALLOWED_HOSTNAMES

  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig()
      const turnstileConfig = config.turnstile as Record<string, unknown> | undefined
      const publicTurnstileConfig = config.public?.turnstile as Record<string, unknown> | undefined

      return {
        enabled: booleanConfigValue(publicTurnstileConfig?.enabled ?? envEnabled, false),
        secretKey: stringConfigValue(turnstileConfig?.secretKey ?? envSecretKey),
        siteVerifyURLOverride: stringConfigValue(turnstileConfig?.siteVerifyURLOverride ?? envSiteVerifyURLOverride) || undefined,
        allowedHostnames: csvConfigValue(turnstileConfig?.allowedHostnames ?? envAllowedHostnames)
      }
    }
  } catch {
    // Fall back to environment variables for tests, scripts, and non-Nuxt contexts.
  }

  return {
    enabled: booleanConfigValue(envEnabled, false),
    secretKey: stringConfigValue(envSecretKey),
    siteVerifyURLOverride: stringConfigValue(envSiteVerifyURLOverride) || undefined,
    allowedHostnames: csvConfigValue(envAllowedHostnames)
  }
}

export function createTurnstileCaptchaPlugins(config = getTurnstileProtectionConfig()) {
  if (!config.enabled) return []

  if (!config.secretKey) {
    console.warn(
      'WARNING: NUXT_PUBLIC_TURNSTILE_ENABLED is true but NUXT_TURNSTILE_SECRET_KEY is empty. '
      + 'Protected auth requests will fail closed until Turnstile is configured or disabled.'
    )
  }

  return [
    captcha({
      provider: 'cloudflare-turnstile',
      secretKey: config.secretKey,
      endpoints: TURNSTILE_ENDPOINTS,
      ...(config.siteVerifyURLOverride ? { siteVerifyURLOverride: config.siteVerifyURLOverride } : {}),
      ...(config.allowedHostnames.length > 0 ? { allowedHostnames: config.allowedHostnames } : {})
    })
  ]
}
