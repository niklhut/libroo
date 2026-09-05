import { betterAuth } from 'better-auth/minimal'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin, genericOAuth, twoFactor } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { defaultAc } from 'better-auth/plugins/admin/access'
import { and, eq, gt, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { PASSWORD_MIN_LENGTH } from '~~/shared/utils/password'
import { authAdapterDb, db, schema } from '../runtime/auth-db.active'
import { librooAdminPolicyPlugin } from './libroo-admin-auth-plugin'
import { librooAdminAuditPlugin } from './libroo-admin-audit-plugin'
import { librooSecurityNotificationPlugin } from './libroo-security-notification-plugin'
import { librooTermsConsentPlugin } from './libroo-terms-consent-plugin'
import { getConfigValue, getEmailVerificationConfig, validateEmailVerificationConfig } from './email-verification-config'
import { createTurnstileCaptchaPlugins } from './turnstile'
import { sendEmailMessage } from '../services/email.service'
import { createBackgroundTaskHandler } from '../runtime/background-tasks.active'
import { runtimeProfile } from '../runtime/profile.active'
import { getWebAuthnConfig, passkeysAvailable } from './webauthn-config'
import { librooRecentAuthPlugin } from './libroo-recent-auth-plugin'
import { resolveAuthUrl } from './auth-url'
import { librooPasskeyTwoFactorPlugin } from './libroo-passkey-two-factor-plugin'
import { booleanConfigValue } from '~~/shared/utils/runtime-config'
import { getOidcAccountLinkingOptions, getOidcProviderConfig, oidcProviderConfigured, validateOidcProviderConfig } from './oidc-provider-config'

export const getAuthUrl = resolveAuthUrl

interface EnvSecretOptions {
  envKey: string
  runtimeConfigKey: 'betterAuthSecret' | 'betterAuthUrl'
  devFallback: string
  productionError?: string // If set, throws error in production when missing
  productionWarning?: string // If set, logs warning in production when missing
}

export const LIBROO_CLIENT_IP_HEADER = 'x-libroo-client-ip'
const BOOTSTRAP_CLAIM_ID = 1
const BOOTSTRAP_CLAIM_TTL_MS = 5 * 60 * 1000

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

const emailVerificationConfig = getEmailVerificationConfig()
validateEmailVerificationConfig(emailVerificationConfig)
const authRateLimitEnabled = process.env.NUXT_BETTER_AUTH_RATE_LIMIT_ENABLED !== 'false'
const backgroundTaskHandler = createBackgroundTaskHandler()
const trustedIpHeaders = getTrustedIpHeaders()
const webAuthnConfig = getWebAuthnConfig()
const oidcConfig = getOidcProviderConfig()
validateOidcProviderConfig(oidcConfig)

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

function parseCommaSeparated(value: unknown) {
  if (typeof value !== 'string') return []

  return value
    .split(',')
    .map(header => header.trim().toLowerCase())
    .filter(Boolean)
}

function getConfiguredTrustedIpHeaders() {
  let value: unknown = process.env.NUXT_TRUSTED_IP_HEADERS

  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig() as { trustedIpHeaders?: unknown }
      if (config.trustedIpHeaders) {
        value = config.trustedIpHeaders
      }
    }
  } catch {
    // Ignore error if useRuntimeConfig is not available or fails
  }

  return parseCommaSeparated(value)
}

export function getTrustedIpHeaders() {
  const configuredHeaders = getConfiguredTrustedIpHeaders()
  const platformHeaders = runtimeProfile === 'cloudflare'
    ? ['cf-connecting-ip']
    : []

  return Array.from(new Set([
    ...platformHeaders,
    ...configuredHeaders,
    LIBROO_CLIENT_IP_HEADER
  ]))
}

async function canCreateUserWhenRegistrationIsClosed(userEmail: unknown, contextPath: string | undefined) {
  const registrationEnabled = booleanConfigValue(
    getConfigValue('NUXT_PUBLIC_REGISTRATION_ENABLED', 'public.registrationEnabled'),
    true
  )
  if (registrationEnabled) return true

  // Preserve bootstrap: the first account becomes an admin in
  // librooAdminPolicyPlugin's atomic after-create hook regardless of method.
  // The claim is a database-enforced mutex so two simultaneous requests cannot
  // both observe an empty user table and pass this hook.
  const existingUser = await db.select({ id: schema.user.id }).from(schema.user).limit(1)
  if (existingUser.length === 0) return await claimFirstUserBootstrap()

  // Invite reservations belong exclusively to the intercepted email/password
  // signup request. Never let an unrelated OAuth callback borrow a concurrent
  // reservation (especially a generic invite with no email restriction).
  if (contextPath !== '/sign-up/email') return false

  const email = typeof userEmail === 'string' ? userEmail.trim().toLowerCase() : ''
  if (!email) return false

  // Email/password sign-up reserves an invite before Better Auth reaches this
  // hook. OAuth callbacks have no reservation and are therefore blocked for an
  // invite-only installation after bootstrap.
  const reservation = await db
    .select({ id: schema.signupInvites.id })
    .from(schema.signupInvites)
    .where(and(
      eq(schema.signupInvites.status, 'pending'),
      isNotNull(schema.signupInvites.reservationToken),
      isNotNull(schema.signupInvites.reservationExpiresAt),
      gt(schema.signupInvites.reservationExpiresAt, new Date()),
      gt(schema.signupInvites.expiresAt, new Date()),
      or(isNull(schema.signupInvites.email), eq(schema.signupInvites.email, email))
    ))
    .limit(1)

  return reservation.length > 0
}

async function claimFirstUserBootstrap() {
  const now = new Date()
  const staleBefore = new Date(now.getTime() - BOOTSTRAP_CLAIM_TTL_MS)
  const result = await db.run(sql`
    INSERT INTO ${schema.authBootstrapClaim} (id, claimed_at)
    VALUES (${BOOTSTRAP_CLAIM_ID}, ${now.getTime()})
    ON CONFLICT(id) DO UPDATE SET claimed_at = excluded.claimed_at
    WHERE ${schema.authBootstrapClaim.claimedAt} <= ${staleBefore.getTime()}
  `) as unknown

  return affectedRowCount(result) === 1
}

function affectedRowCount(result: unknown) {
  if (!result || typeof result !== 'object') return 0
  const record = result as Record<string, unknown>
  if (typeof record.changes === 'number') return record.changes
  if (typeof record.rowsAffected === 'number') return record.rowsAffected
  if (typeof record.rowCount === 'number') return record.rowCount
  const meta = record.meta
  return meta && typeof meta === 'object' && typeof (meta as Record<string, unknown>).changes === 'number'
    ? (meta as Record<string, number>).changes
    : 0
}

export const auth = betterAuth({
  baseURL: getAuthUrl(),
  secret: getAuthSecret(),
  database: drizzleAdapter(authAdapterDb, {
    provider: 'sqlite',
    schema
  }),
  emailAndPassword: {
    enabled: oidcConfig.emailPasswordEnabled,
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
  rateLimit: {
    enabled: authRateLimitEnabled,
    storage: 'database'
  },
  advanced: {
    ipAddress: {
      ipAddressHeaders: trustedIpHeaders
    },
    backgroundTasks: backgroundTaskHandler
      ? {
          handler: backgroundTaskHandler
        }
      : undefined,
    crossSubDomainCookies: {
      enabled: false
    }
  },
  user: {
    changeEmail: {
      enabled: true,
      updateEmailWithoutVerification: !emailVerificationConfig.enabled
    },
    additionalFields: {
      pendingEmail: {
        type: 'string',
        required: false,
        input: false,
        returned: false
      },
      termsAcceptedAt: {
        type: 'date',
        required: false,
        input: false,
        returned: false
      }
    }
  },
  account: {
    accountLinking: getOidcAccountLinkingOptions(oidcConfig)
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, context) => await canCreateUserWhenRegistrationIsClosed(user.email, context?.path)
      }
    }
  },
  socialProviders: {},
  plugins: [
    ...createTurnstileCaptchaPlugins(),
    twoFactor({
      issuer: 'Libroo',
      // Password accounts still have to provide their password. This lets
      // OIDC-only accounts rely on Libroo's recent-authentication gate.
      allowPasswordless: true
    }),
    ...(oidcProviderConfigured(oidcConfig) && oidcConfig.provider
      ? [genericOAuth({
          config: [{
            providerId: oidcConfig.provider.providerId,
            clientId: oidcConfig.provider.clientId,
            clientSecret: oidcConfig.provider.clientSecret,
            discoveryUrl: oidcConfig.provider.discoveryUrl,
            authorizationUrl: oidcConfig.provider.authorizationUrl,
            tokenUrl: oidcConfig.provider.tokenUrl,
            userInfoUrl: oidcConfig.provider.userInfoUrl,
            scopes: oidcConfig.provider.scopes
          }]
        })]
      : []),
    ...(passkeysAvailable(webAuthnConfig)
      ? [passkey({
          rpID: webAuthnConfig.rpID,
          rpName: 'Libroo',
          origin: webAuthnConfig.origin
        }), librooPasskeyTwoFactorPlugin()]
      : []),
    librooTermsConsentPlugin(),
    admin({
      roles: {
        admin: adminRole,
        user: userRole
      }
    }),
    librooAdminAuditPlugin(),
    librooSecurityNotificationPlugin(),
    librooRecentAuthPlugin(),
    librooAdminPolicyPlugin()
  ]
})

export type Auth = typeof auth
