// https://nuxt.com/docs/api/configuration/nuxt-config
const runtimeProfile = process.env.NUXT_LIBROO_RUNTIME_PROFILE === 'cloudflare'
  ? 'cloudflare'
  : 'selfhost'
const cloudflareD1DatabaseId = process.env.NUXT_HUB_CLOUDFLARE_DATABASE_ID
const cloudflareR2BucketName = process.env.NUXT_HUB_CLOUDFLARE_BUCKET_NAME
const cloudflareWorkerName = process.env.NUXT_CLOUDFLARE_WORKER_NAME || 'libroo'

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
    emailProvider: runtimeProfile === 'cloudflare' ? 'plunk' : 'smtp',
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

  alias: {
    '../runtime/active': `./server/runtime/${runtimeProfile}.ts`,
    '../runtime/auth-db.active': `./server/runtime/auth-db.${runtimeProfile}.ts`,
    '../runtime/email.active': `./server/runtime/email.${runtimeProfile}.ts`
  },

  routeRules: {
    '/': { prerender: true }
  },

  compatibilityDate: '2025-01-15',

  nitro: {
    cloudflare: runtimeProfile === 'cloudflare'
      ? {
          wrangler: {
            name: cloudflareWorkerName
          }
        }
      : undefined,
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

  hub: runtimeProfile === 'cloudflare'
    ? {
        db: {
          dialect: 'sqlite',
          driver: 'd1',
          connection: cloudflareD1DatabaseId
            ? { databaseId: cloudflareD1DatabaseId }
            : undefined
        },
        blob: cloudflareR2BucketName
          ? {
              driver: 'cloudflare-r2',
              binding: 'BLOB',
              bucketName: cloudflareR2BucketName
            }
          : true
      }
    : {
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
