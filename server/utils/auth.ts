import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins'
import { defaultAc } from 'better-auth/plugins/admin/access'
import { eq } from 'drizzle-orm'
import { PASSWORD_MIN_LENGTH } from '~~/shared/utils/password'
import { db, schema } from '../runtime/auth-db.active'
import { librooAdminPolicyPlugin } from './libroo-admin-auth-plugin'
import { librooAdminAuditPlugin } from './libroo-admin-audit-plugin'
import { librooSecurityNotificationPlugin } from './libroo-security-notification-plugin'
import { librooTermsConsentPlugin } from './libroo-terms-consent-plugin'
import { getEmailVerificationConfig, validateEmailVerificationConfig } from './email-verification-config'
import { createTurnstileCaptchaPlugins } from './turnstile'
import { sendEmailMessage } from '../services/email.service'

interface EnvSecretOptions {
  envKey: string
  runtimeConfigKey: 'betterAuthSecret' | 'betterAuthUrl'
  devFallback: string
  productionError?: string // If set, throws error in production when missing
  productionWarning?: string // If set, logs warning in production when missing
}

/**
 * Unified helper to load secrets/config from env vars or Nuxt runtime config.
 * Handles consistent validation including trim() checks.
 */
const getEnvSecret = (options: EnvSecretOptions): string => {
  const { envKey, runtimeConfigKey, devFallback, productionError, productionWarning } = options

  let value = process.env[envKey]

  // Try to use Nuxt runtime config if available (failsafe for CLI usage)
  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig()
      const runtimeValue = config[runtimeConfigKey]
      if (runtimeValue) {
        value = runtimeValue
      }
    }
  } catch {
    // Ignore error if useRuntimeConfig is not available or fails
  }

  const isProduction = process.env.NODE_ENV === 'production'
  const isEmpty = !value || value.trim() === ''

  if (isEmpty) {
    if (isProduction) {
      if (productionError) {
        throw new Error(productionError)
      }
      if (productionWarning) {
        console.warn(productionWarning)
      }
    }
    return devFallback
  }

  return value as string
}

export const getAuthSecret = () => getEnvSecret({
  envKey: 'NUXT_BETTER_AUTH_SECRET',
  runtimeConfigKey: 'betterAuthSecret',
  devFallback: 'libroo-dev-secret',
  productionError:
    'CRITICAL: NUXT_BETTER_AUTH_SECRET environment variable is missing or empty. '
    + 'This is required in production to ensure session security. '
    + 'Please set NUXT_BETTER_AUTH_SECRET in your production environment.'
})

export const getAuthUrl = () => getEnvSecret({
  envKey: 'NUXT_BETTER_AUTH_URL',
  runtimeConfigKey: 'betterAuthUrl',
  devFallback: 'http://localhost:3000',
  productionWarning:
    'WARNING: NUXT_BETTER_AUTH_URL is not set in production. '
    + 'Using default http://localhost:3000 which may cause authentication failures.'
})

const emailVerificationConfig = getEmailVerificationConfig()
validateEmailVerificationConfig(emailVerificationConfig)

const adminRole = defaultAc.newRole({
  user: [
    'create',
    'list',
    'set-role',
    'ban',
    'delete',
    'set-password',
    'get',
    'update'
  ],
  session: [
    'list',
    'revoke',
    'delete'
  ]
})

const userRole = defaultAc.newRole({
  user: [],
  session: []
})

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function getPublicVerificationUrl(url: string) {
  try {
    const verificationUrl = new URL('/verify-email', getAuthUrl())
    const token = new URL(url).searchParams.get('token')

    if (token) {
      verificationUrl.searchParams.set('token', token)
      return verificationUrl.toString()
    }
  } catch {
    // Fall back to the provider URL if Better Auth ever changes the URL shape.
  }

  return url
}

function getPublicPasswordResetUrl(token: string) {
  const resetUrl = new URL('/reset-password', getAuthUrl())
  resetUrl.searchParams.set('token', token)
  return resetUrl.toString()
}

export const auth = betterAuth({
  baseURL: getAuthUrl(),
  secret: getAuthSecret(),
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    requireEmailVerification: emailVerificationConfig.enabled,
    autoSignIn: emailVerificationConfig.enabled ? false : undefined,
    sendResetPassword: async ({ user, token }) => {
      const displayName = escapeHtml(user.name)
      const resetUrl = getPublicPasswordResetUrl(token)
      const safeUrl = escapeHtml(resetUrl)
      await sendEmailMessage({
        to: user.email,
        subject: 'Reset your Libroo password',
        text: [
          `Hello ${user.name},`,
          '',
          'Reset your Libroo password by opening this link:',
          resetUrl,
          '',
          'This link expires in 1 hour. If you did not request this, you can ignore this email.'
        ].join('\n'),
        html: [
          `<p>Hello ${displayName},</p>`,
          '<p>Reset your Libroo password by opening this link:</p>',
          `<p><a href="${safeUrl}">Reset password</a></p>`,
          '<p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>'
        ].join('')
      })
    }
  },
  emailVerification: emailVerificationConfig.enabled
    ? {
        sendOnSignUp: true,
        sendOnSignIn: true,
        autoSignInAfterVerification: true,
        expiresIn: 60 * 60 * 24,
        afterEmailVerification: async (user) => {
          await db
            .update(schema.user)
            .set({ pendingEmail: null })
            .where(eq(schema.user.id, user.id))
        },
        sendVerificationEmail: async ({ user, url }) => {
          const displayName = escapeHtml(user.name)
          const verificationUrl = getPublicVerificationUrl(url)
          const safeUrl = escapeHtml(verificationUrl)
          await sendEmailMessage({
            to: user.email,
            subject: 'Verify your Libroo email address',
            text: [
              `Hello ${user.name},`,
              '',
              'Verify your email address for Libroo by opening this link:',
              verificationUrl,
              '',
              'This link expires in 24 hours. If you did not request this, you can ignore this email.'
            ].join('\n'),
            html: [
              `<p>Hello ${displayName},</p>`,
              '<p>Verify your email address for Libroo by opening this link:</p>',
              `<p><a href="${safeUrl}">Verify email address</a></p>`,
              '<p>This link expires in 24 hours. If you did not request this, you can ignore this email.</p>'
            ].join('')
          })
        }
      }
    : undefined,
  trustedOrigins: [getAuthUrl()],
  advanced: {
    crossSubDomainCookies: {
      enabled: false
    }
  },
  user: {
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: !emailVerificationConfig.enabled
    }
  },
  socialProviders: {
    // Placeholder for social providers
    // google: {
    //   clientId: process.env.GOOGLE_CLIENT_ID!,
    //   clientSecret: process.env.GOOGLE_CLIENT_SECRET!
    // },
    // github: {
    //   clientId: process.env.GITHUB_CLIENT_ID!,
    //   clientSecret: process.env.GITHUB_CLIENT_SECRET!
    // }
  },
  plugins: [
    ...createTurnstileCaptchaPlugins(),
    librooTermsConsentPlugin(),
    admin({
      roles: {
        admin: adminRole,
        user: userRole
      }
    }),
    librooAdminAuditPlugin(),
    librooSecurityNotificationPlugin(),
    librooAdminPolicyPlugin()
  ]
})

export type Auth = typeof auth
