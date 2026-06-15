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
    betterAuthSecret: '',
    betterAuthUrl: '',
    authAuditRetentionDays: '5',
    adminAuditRetentionDays: '30',
    emailVerificationEnabled: 'false',
    emailProvider: 'smtp',
    emailFrom: '',
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: 'false',
    smtpUser: '',
    smtpPassword: '',
    plunkApiKey: '',
    plunkBaseUrl: 'https://next-api.useplunk.com',
    public: {
      registrationEnabled: 'true'
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
