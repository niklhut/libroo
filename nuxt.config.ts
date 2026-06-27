// https://nuxt.com/docs/api/configuration/nuxt-config
const runtimeProfile = process.env.NUXT_LIBROO_RUNTIME_PROFILE === 'cloudflare'
  ? 'cloudflare'
  : 'selfhost'
const cloudflareD1DatabaseId = process.env.NUXT_HUB_CLOUDFLARE_DATABASE_ID
const cloudflareR2BucketName = process.env.NUXT_HUB_CLOUDFLARE_BUCKET_NAME
const cloudflareWorkerName = process.env.NUXT_CLOUDFLARE_WORKER_NAME || 'libroo'
const rawCloudflareCustomDomain = process.env.NUXT_CLOUDFLARE_CUSTOM_DOMAIN
const cloudflareCustomDomain = rawCloudflareCustomDomain
  ? /^https?:\/\//.test(rawCloudflareCustomDomain)
    ? new URL(rawCloudflareCustomDomain).hostname
    : rawCloudflareCustomDomain
  : undefined
const cloudflarePreview = process.env.NUXT_CLOUDFLARE_PREVIEW === 'true'

function definedEnvVars(vars: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(vars).filter(([, value]) => value !== undefined && value !== '')
  )
}

const cloudflareRuntimeVars = definedEnvVars({
  NUXT_BETTER_AUTH_URL: process.env.NUXT_BETTER_AUTH_URL,
  NUXT_CLOUDFLARE_ACCESS_AUDIENCE: process.env.NUXT_CLOUDFLARE_ACCESS_AUDIENCE,
  NUXT_CLOUDFLARE_ACCESS_TEAM_DOMAIN: process.env.NUXT_CLOUDFLARE_ACCESS_TEAM_DOMAIN,
  NUXT_CLOUDFLARE_PREVIEW: cloudflarePreview ? 'true' : undefined,
  NUXT_EMAIL_FROM: process.env.NUXT_EMAIL_FROM,
  NUXT_EMAIL_REPLY_TO: process.env.NUXT_EMAIL_REPLY_TO,
  NUXT_EMAIL_VERIFICATION_ENABLED: process.env.NUXT_EMAIL_VERIFICATION_ENABLED,
  NUXT_LEGAL_IMPRINT_MARKDOWN_URL: process.env.NUXT_LEGAL_IMPRINT_MARKDOWN_URL,
  NUXT_LEGAL_MARKDOWN_FETCH_TIMEOUT_SECONDS: process.env.NUXT_LEGAL_MARKDOWN_FETCH_TIMEOUT_SECONDS || '5',
  NUXT_LEGAL_PRIVACY_POLICY_MARKDOWN_URL: process.env.NUXT_LEGAL_PRIVACY_POLICY_MARKDOWN_URL,
  NUXT_LEGAL_TERMS_MARKDOWN_URL: process.env.NUXT_LEGAL_TERMS_MARKDOWN_URL,
  NUXT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS: process.env.NUXT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS || '20',
  NUXT_OPEN_LIBRARY_REQUEST_TIMEOUT_SECONDS: process.env.NUXT_OPEN_LIBRARY_REQUEST_TIMEOUT_SECONDS || '12',
  NUXT_PLUNK_BASE_URL: process.env.NUXT_PLUNK_BASE_URL,
  NUXT_PLUNK_SEND_TIMEOUT_SECONDS: process.env.NUXT_PLUNK_SEND_TIMEOUT_SECONDS || '5',
  NUXT_PUBLIC_OPEN_LIBRARY_LINKS_ENABLED: process.env.NUXT_PUBLIC_OPEN_LIBRARY_LINKS_ENABLED,
  NUXT_PUBLIC_LEGAL_IMPRINT_URL: process.env.NUXT_PUBLIC_LEGAL_IMPRINT_URL,
  NUXT_PUBLIC_LEGAL_PRIVACY_POLICY_URL: process.env.NUXT_PUBLIC_LEGAL_PRIVACY_POLICY_URL,
  NUXT_PUBLIC_LEGAL_TERMS_URL: process.env.NUXT_PUBLIC_LEGAL_TERMS_URL,
  NUXT_PUBLIC_REGISTRATION_ENABLED: process.env.NUXT_PUBLIC_REGISTRATION_ENABLED,
  NUXT_PUBLIC_TURNSTILE_ENABLED: process.env.NUXT_PUBLIC_TURNSTILE_ENABLED,
  NUXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NUXT_PUBLIC_TURNSTILE_SITE_KEY,
  NUXT_TURNSTILE_ALLOWED_HOSTNAMES: process.env.NUXT_TURNSTILE_ALLOWED_HOSTNAMES,
  ...(cloudflarePreview
    ? { NUXT_TURNSTILE_SECRET_KEY: process.env.NUXT_TURNSTILE_SECRET_KEY }
    : {})
})
const hasCloudflareRuntimeVars = Object.keys(cloudflareRuntimeVars).length > 0

export default defineNuxtConfig({
  modules: [
    '@nuxthub/core',
    '@pinia/nuxt',
    '@nuxt/eslint',
    '@nuxt/ui',
    '@nuxt/hints',
    '@nuxt/image',
    '@nuxt/scripts',
    '@nuxtjs/turnstile',
    '@nuxt/test-utils',
    '@comark/nuxt'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    betterAuthSecret: '',
    betterAuthUrl: '',
    cloudflareAccessAudience: '',
    cloudflareAccessTeamDomain: '',
    cloudflarePreview: '',
    authAuditRetentionDays: '5',
    adminAuditRetentionDays: '30',
    emailVerificationEnabled: 'false',
    emailProvider: runtimeProfile === 'cloudflare' ? 'plunk' : 'smtp',
    emailFrom: '',
    emailReplyTo: '',
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: 'false',
    smtpUser: '',
    smtpPassword: '',
    plunkApiKey: '',
    plunkBaseUrl: 'https://next-api.useplunk.com',
    plunkSendTimeoutSeconds: '5',
    openLibraryCoverTimeoutSeconds: '20',
    openLibraryRequestTimeoutSeconds: '12',
    legalMarkdownFetchTimeoutSeconds: '5',
    legalPrivacyPolicyMarkdownUrl: '',
    legalImprintMarkdownUrl: '',
    legalTermsMarkdownUrl: '',
    turnstile: {
      secretKey: '',
      allowedHostnames: '',
      siteVerifyURLOverride: ''
    },
    public: {
      registrationEnabled: 'true',
      openLibraryLinksEnabled: process.env.NODE_ENV === 'development' ? 'true' : 'false',
      legalPrivacyPolicyUrl: '',
      legalImprintUrl: '',
      legalTermsUrl: '',
      turnstile: {
        enabled: process.env.NUXT_PUBLIC_TURNSTILE_ENABLED ?? 'false',
        siteKey: ''
      }
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
            name: cloudflareWorkerName,
            ...(cloudflareCustomDomain
              ? {
                  routes: [
                    {
                      pattern: cloudflareCustomDomain,
                      custom_domain: true
                    }
                  ],
                  workers_dev: false
                }
              : { workers_dev: true }),
            ...(hasCloudflareRuntimeVars ? { vars: cloudflareRuntimeVars } : {}),
            ...(!cloudflarePreview
              ? {
                  triggers: {
                    crons: ['0 3 * * *', '30 3 * * *']
                  }
                }
              : {}),
            observability: {
              enabled: true,
              logs: {
                enabled: true
              }
            },
            upload_source_maps: true
          }
        }
      : undefined,
    experimental: {
      tasks: true
    },
    scheduledTasks: {
      '0 3 * * *': 'audit:cleanup',
      '30 3 * * *': 'books:repair-covers'
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
        },
        'books:repair-covers': {
          handler: './tasks/books/repair-covers.ts',
          description: 'Try to fetch missing Open Library cover images for existing books.'
        }
      }
      nitroConfig.scheduledTasks = {
        ...nitroConfig.scheduledTasks,
        '0 3 * * *': 'audit:cleanup',
        '30 3 * * *': 'books:repair-covers'
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

  hints: {
    features: {
      lazyLoad: {
        logs: false,
        devtools: false
      }
    }
  },

  image: {
    provider: 'none'
  },

  turnstile: {
    siteKey: process.env.NUXT_PUBLIC_TURNSTILE_SITE_KEY
  }
})
