export type EmailProvider = 'smtp' | 'plunk'

export interface EmailVerificationConfig {
  enabled: boolean
  provider: EmailProvider
  from: string
  smtp: {
    host: string
    port: number
    secure: boolean
    user?: string
    password?: string
  } | null
  plunk: {
    apiKey: string
    baseUrl: string
  } | null
}

const truthyValues = new Set(['1', 'true', 'yes', 'on'])

function getConfigValue(key: string, runtimeKey: string): string | undefined {
  const envValue = process.env[key]
  if (envValue && envValue.trim()) {
    return envValue
  }

  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig()
      const runtimeValue = config[runtimeKey]
      if (typeof runtimeValue === 'string' && runtimeValue.trim()) {
        return runtimeValue
      }
    }
  } catch {
    // Runtime config is unavailable in some CLI and test contexts.
  }
}

function getBooleanConfig(key: string, runtimeKey: string, fallback = false) {
  const value = getConfigValue(key, runtimeKey)
  return value ? truthyValues.has(value.trim().toLowerCase()) : fallback
}

function getNumberConfig(key: string, runtimeKey: string, fallback: number) {
  const value = getConfigValue(key, runtimeKey)
  if (!value) return fallback

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getEmailProvider(): EmailProvider {
  const provider = getConfigValue('LIBROO_EMAIL_PROVIDER', 'emailProvider')
  return provider === 'plunk' ? 'plunk' : 'smtp'
}

export function getEmailVerificationConfig(): EmailVerificationConfig {
  const enabled = getBooleanConfig('LIBROO_EMAIL_VERIFICATION_ENABLED', 'emailVerificationEnabled')
  const provider = getEmailProvider()
  const host = getConfigValue('LIBROO_SMTP_HOST', 'smtpHost')
  const from = getConfigValue('LIBROO_EMAIL_FROM', 'emailFrom') ?? ''
  const plunkApiKey = getConfigValue('LIBROO_PLUNK_API_KEY', 'plunkApiKey')

  if (!enabled) {
    return {
      enabled: false,
      provider,
      from,
      smtp: null,
      plunk: null
    }
  }

  return {
    enabled,
    provider,
    from,
    smtp: provider === 'smtp' && host
      ? {
          host,
          port: getNumberConfig('LIBROO_SMTP_PORT', 'smtpPort', 587),
          secure: getBooleanConfig('LIBROO_SMTP_SECURE', 'smtpSecure'),
          user: getConfigValue('LIBROO_SMTP_USER', 'smtpUser'),
          password: getConfigValue('LIBROO_SMTP_PASSWORD', 'smtpPassword')
        }
      : null,
    plunk: provider === 'plunk' && plunkApiKey
      ? {
          apiKey: plunkApiKey,
          baseUrl: getConfigValue('LIBROO_PLUNK_BASE_URL', 'plunkBaseUrl') ?? 'https://next-api.useplunk.com'
        }
      : null
  }
}

export function validateEmailVerificationConfig(config = getEmailVerificationConfig()) {
  if (!config.enabled) return

  const missing: string[] = []

  if (config.provider === 'smtp') {
    if (!config.from) missing.push('LIBROO_EMAIL_FROM')
    if (!config.smtp?.host) missing.push('LIBROO_SMTP_HOST')
    if (!config.smtp?.port) missing.push('LIBROO_SMTP_PORT')

    if (config.smtp?.user && !config.smtp.password) {
      missing.push('LIBROO_SMTP_PASSWORD')
    }
  }

  if (config.provider === 'plunk') {
    if (!config.plunk?.apiKey) missing.push('LIBROO_PLUNK_API_KEY')
    if (!config.plunk?.baseUrl) missing.push('LIBROO_PLUNK_BASE_URL')
  }

  if (missing.length > 0) {
    throw new Error(
      `Email verification is enabled, but email delivery is not configured. Missing: ${missing.join(', ')}. `
      + 'Set these values or disable LIBROO_EMAIL_VERIFICATION_ENABLED.'
    )
  }
}
