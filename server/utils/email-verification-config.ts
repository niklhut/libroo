export type EmailProvider = 'smtp' | 'plunk'

export interface EmailVerificationConfig {
  enabled: boolean
  provider: EmailProvider
  from: string
  replyTo: string
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

export type EmailDeliveryConfig = Omit<EmailVerificationConfig, 'enabled'>

const truthyValues = new Set(['1', 'true', 'yes', 'on'])

function getRuntimeConfigValue(runtimeKey: string): string | undefined {
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

function getConfigValue(envKey: string, runtimeKey: string): string | undefined {
  const runtimeValue = getRuntimeConfigValue(runtimeKey)
  if (runtimeValue) return runtimeValue

  const envValue = process.env[envKey]
  return envValue && envValue.trim() ? envValue : undefined
}

function getBooleanConfig(envKey: string, runtimeKey: string, fallback = false) {
  const value = getConfigValue(envKey, runtimeKey)
  return value ? truthyValues.has(value.trim().toLowerCase()) : fallback
}

function parseBooleanConfigValue(value: string | undefined, fallback = false) {
  return value ? truthyValues.has(value.trim().toLowerCase()) : fallback
}

function getNumberConfig(key: string, runtimeKey: string, fallback: number) {
  const value = getConfigValue(key, runtimeKey)
  if (!value) return fallback

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function getEmailProvider(): EmailProvider {
  const provider = getConfigValue('NUXT_EMAIL_PROVIDER', 'emailProvider')
  if (provider === 'plunk' || provider === 'smtp') {
    return provider
  }

  return process.env.NUXT_LIBROO_RUNTIME_PROFILE === 'cloudflare' ? 'plunk' : 'smtp'
}

export function getEmailVerificationConfig(): EmailVerificationConfig {
  const enabled = parseBooleanConfigValue(getConfigValue('NUXT_EMAIL_VERIFICATION_ENABLED', 'emailVerificationEnabled'))
  const deliveryConfig = getEmailDeliveryConfig()

  if (!enabled) {
    return {
      enabled: false,
      ...deliveryConfig,
      smtp: null,
      plunk: null
    }
  }

  return {
    enabled,
    ...deliveryConfig
  }
}

export function getEmailDeliveryConfig(): EmailDeliveryConfig {
  const provider = getEmailProvider()
  const host = getConfigValue('NUXT_SMTP_HOST', 'smtpHost')
  const from = getConfigValue('NUXT_EMAIL_FROM', 'emailFrom') ?? ''
  const replyTo = getConfigValue('NUXT_EMAIL_REPLY_TO', 'emailReplyTo') ?? ''
  const plunkApiKey = getConfigValue('NUXT_PLUNK_API_KEY', 'plunkApiKey')

  return {
    provider,
    from,
    replyTo,
    smtp: provider === 'smtp' && host
      ? {
          host,
          port: getNumberConfig('NUXT_SMTP_PORT', 'smtpPort', 587),
          secure: getBooleanConfig('NUXT_SMTP_SECURE', 'smtpSecure'),
          user: getConfigValue('NUXT_SMTP_USER', 'smtpUser'),
          password: getConfigValue('NUXT_SMTP_PASSWORD', 'smtpPassword')
        }
      : null,
    plunk: provider === 'plunk' && plunkApiKey
      ? {
          apiKey: plunkApiKey,
          baseUrl: getConfigValue('NUXT_PLUNK_BASE_URL', 'plunkBaseUrl') ?? 'https://next-api.useplunk.com'
        }
      : null
  }
}

export function emailDeliveryConfigured(config = getEmailDeliveryConfig()) {
  if (config.provider === 'smtp') {
    const hasAuthPair = (!config.smtp?.user && !config.smtp?.password)
      || (Boolean(config.smtp?.user) && Boolean(config.smtp?.password))
    return Boolean(config.from && config.smtp?.host && hasAuthPair)
  }

  return Boolean(config.from && config.plunk?.apiKey && config.plunk?.baseUrl)
}

export function validateEmailVerificationConfig(config = getEmailVerificationConfig()) {
  if (!config.enabled) return

  try {
    validateEmailDeliveryConfig(config)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email delivery is not configured.'
    throw new Error(
      `Email verification is enabled, but ${message.charAt(0).toLowerCase()}${message.slice(1)} `
      + 'Set these values or disable NUXT_EMAIL_VERIFICATION_ENABLED.',
      { cause: error }
    )
  }
}

export function validateEmailDeliveryConfig(config = getEmailDeliveryConfig()) {
  const missing: string[] = []

  if (config.provider === 'smtp') {
    if (!config.from) missing.push('NUXT_EMAIL_FROM')
    if (!config.smtp?.host) {
      missing.push('NUXT_SMTP_HOST')
    } else if (!config.smtp.port) {
      missing.push('NUXT_SMTP_PORT')
    }

    if (config.smtp?.user && !config.smtp.password) {
      missing.push('NUXT_SMTP_PASSWORD')
    }
    if (!config.smtp?.user && config.smtp?.password) {
      missing.push('NUXT_SMTP_USER')
    }
  }

  if (config.provider === 'plunk') {
    if (!config.from) missing.push('NUXT_EMAIL_FROM')
    if (!config.plunk?.apiKey) missing.push('NUXT_PLUNK_API_KEY')
    if (!config.plunk?.baseUrl) missing.push('NUXT_PLUNK_BASE_URL')
  }

  if (missing.length > 0) {
    throw new Error(
      `Email delivery is not configured. Missing: ${missing.join(', ')}.`
    )
  }
}
