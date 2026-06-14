const truthyValues = new Set(['1', 'true', 'yes', 'on'])
const emailVerificationEnabledRaw = process.env.LIBROO_EMAIL_VERIFICATION_ENABLED ?? ''
const emailVerificationEnabled = truthyValues.has(emailVerificationEnabledRaw.trim().toLowerCase())
const publicRegistrationEnabledRaw = process.env.LIBROO_PUBLIC_REGISTRATION_ENABLED ?? 'true'
const publicRegistrationEnabled = truthyValues.has(publicRegistrationEnabledRaw.trim().toLowerCase())
const emailProvider = process.env.LIBROO_EMAIL_PROVIDER === 'plunk' ? 'plunk' : 'smtp'
const smtpAuthConfigured = (!process.env.LIBROO_SMTP_USER && !process.env.LIBROO_SMTP_PASSWORD)
  || Boolean(process.env.LIBROO_SMTP_USER && process.env.LIBROO_SMTP_PASSWORD)
const emailDeliveryEnabled = emailProvider === 'plunk'
  ? Boolean(process.env.LIBROO_PLUNK_API_KEY && (process.env.LIBROO_PLUNK_BASE_URL ?? 'https://next-api.useplunk.com'))
  : Boolean(process.env.LIBROO_EMAIL_FROM && process.env.LIBROO_SMTP_HOST && smtpAuthConfigured)

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxthub/core',
    '@pinia/nuxt',
    '@nuxt/eslint',
    '@nuxt/ui',
    '@nuxt/hints',
    '@nuxt/image',
    '@nuxt/scripts',
    '@nuxt/test-utils'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    betterAuthSecret: process.env.BETTER_AUTH_SECRET,
    betterAuthUrl: process.env.BETTER_AUTH_URL,
    authAuditRetentionDays: process.env.LIBROO_AUTH_AUDIT_RETENTION_DAYS ?? '5',
    adminAuditRetentionDays: process.env.LIBROO_ADMIN_AUDIT_RETENTION_DAYS ?? '30',
    emailVerificationEnabled: emailVerificationEnabledRaw,
    publicRegistrationEnabled: publicRegistrationEnabledRaw,
    emailProvider: process.env.LIBROO_EMAIL_PROVIDER,
    emailFrom: process.env.LIBROO_EMAIL_FROM,
    smtpHost: process.env.LIBROO_SMTP_HOST,
    smtpPort: process.env.LIBROO_SMTP_PORT,
    smtpSecure: process.env.LIBROO_SMTP_SECURE,
    smtpUser: process.env.LIBROO_SMTP_USER,
    smtpPassword: process.env.LIBROO_SMTP_PASSWORD,
    plunkApiKey: process.env.LIBROO_PLUNK_API_KEY,
    plunkBaseUrl: process.env.LIBROO_PLUNK_BASE_URL,
    public: {
      emailVerificationEnabled,
      publicRegistrationEnabled,
      emailDeliveryEnabled
    }
  },

  routeRules: {
    '/': { prerender: true }
  },

  compatibilityDate: '2025-01-15',

  nitro: {
    experimental: {
      tasks: true
    },
    scheduledTasks: {
      '0 3 * * *': 'audit:cleanup'
    },
    imports: {
      dirs: [
        './server/services',
        './server/repositories'
      ]
    }
  },

  hub: {
    db: 'sqlite',
    blob: true
  },

  hooks: {
    'nitro:config'(nitroConfig) {
      nitroConfig.experimental = {
        ...nitroConfig.experimental,
        tasks: true
      }
      nitroConfig.tasks = {
        ...nitroConfig.tasks,
        'audit:cleanup': {
          handler: './tasks/audit/cleanup.ts',
          description: 'Delete expired admin and auth audit log entries.'
        }
      }
      nitroConfig.scheduledTasks = {
        ...nitroConfig.scheduledTasks,
        '0 3 * * *': 'audit:cleanup'
      }
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs',
        semi: false,
        quotes: 'single'
      }
    }
  },

  image: {
    provider: 'none'
  }
})
