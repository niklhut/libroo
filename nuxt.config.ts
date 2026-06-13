const truthyValues = new Set(['1', 'true', 'yes', 'on'])
const emailVerificationEnabledRaw = process.env.LIBROO_EMAIL_VERIFICATION_ENABLED ?? ''
const emailVerificationEnabled = truthyValues.has(emailVerificationEnabledRaw.trim().toLowerCase())

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
    emailVerificationEnabled: emailVerificationEnabledRaw,
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
      emailVerificationEnabled
    }
  },

  routeRules: {
    '/': { prerender: true }
  },

  compatibilityDate: '2025-01-15',

  nitro: {
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
