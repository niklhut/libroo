import { APIError, createAuthMiddleware } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'

type UserCreateContext = {
  path?: string
}

const SIGN_UP_EMAIL_PATH = '/sign-up/email'

export const librooTermsConsentPlugin = (): BetterAuthPlugin => ({
  id: 'libroo-terms-consent',
  init() {
    return {
      options: {
        databaseHooks: {
          user: {
            create: {
              before: async (data, context?: UserCreateContext | null) => {
                if (context?.path !== SIGN_UP_EMAIL_PATH || !termsAreConfigured()) {
                  return { data }
                }

                return {
                  data: {
                    ...data,
                    termsAcceptedAt: new Date()
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  hooks: {
    before: [
      {
        matcher: context => context.path === SIGN_UP_EMAIL_PATH,
        handler: createAuthMiddleware(async (ctx) => {
          if (!termsAreConfigured()) return
          if (readBooleanField(ctx.body, 'acceptTerms') === true) return

          throw APIError.from('BAD_REQUEST', {
            message: 'You must agree to the Terms of Service to create an account',
            code: 'TERMS_ACCEPTANCE_REQUIRED'
          })
        })
      }
    ]
  }
})

export function termsAreConfigured() {
  const config = getTermsConfig()
  return Boolean(config.publicTermsUrl || config.termsMarkdownUrl)
}

function getTermsConfig() {
  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig()
      return {
        publicTermsUrl: configString(config.public?.legalTermsUrl),
        termsMarkdownUrl: configString(config.legalTermsMarkdownUrl)
      }
    }
  } catch {
    // Fall back to environment variables for tests, scripts, and non-Nuxt contexts.
  }

  return {
    publicTermsUrl: configString(process.env.NUXT_PUBLIC_LEGAL_TERMS_URL),
    termsMarkdownUrl: configString(process.env.NUXT_LEGAL_TERMS_MARKDOWN_URL)
  }
}

function configString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function readBooleanField(source: unknown, key: string) {
  if (!source || typeof source !== 'object') return null
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'boolean' ? value : null
}
