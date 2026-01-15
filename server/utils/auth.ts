import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import * as schema from 'hub:db:schema'
import { db } from 'hub:db'

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

const getAuthSecret = () => getEnvSecret({
  envKey: 'BETTER_AUTH_SECRET',
  runtimeConfigKey: 'betterAuthSecret',
  devFallback: 'libroo-dev-secret',
  productionError:
    'CRITICAL: BETTER_AUTH_SECRET environment variable is missing or empty. '
    + 'This is required in production to ensure session security. '
    + 'Please set BETTER_AUTH_SECRET or NUXT_BETTER_AUTH_SECRET in your production environment.'
})

const getAuthUrl = () => getEnvSecret({
  envKey: 'BETTER_AUTH_URL',
  runtimeConfigKey: 'betterAuthUrl',
  devFallback: 'http://localhost:3000',
  productionWarning:
    'WARNING: BETTER_AUTH_URL is not set in production. '
    + 'Using default http://localhost:3000 which may cause authentication failures.'
})

export const auth = betterAuth({
  baseURL: getAuthUrl(),
  secret: getAuthSecret(),
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema
  }),
  emailAndPassword: {
    enabled: true
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
  }
})

export type Auth = typeof auth
