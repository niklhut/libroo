import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import * as schema from 'hub:db:schema'
import { db } from 'hub:db'

// Validate auth secret and fail fast in production if missing
const getAuthSecret = () => {
  let secret = process.env.BETTER_AUTH_SECRET

  // Try to use Nuxt runtime config if available (failsafe for CLI usage)
  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig()
      if (config.betterAuthSecret) {
        secret = config.betterAuthSecret
      }
    }
  } catch {
    // Ignore error if useRuntimeConfig is not available or fails
  }

  const isProduction = process.env.NODE_ENV === 'production'

  if (!secret || secret.trim() === '') {
    if (isProduction) {
      throw new Error(
        'CRITICAL: BETTER_AUTH_SECRET environment variable is missing or empty. ' +
        'This is required in production to ensure session security. ' +
        'Please set BETTER_AUTH_SECRET or NUXT_BETTER_AUTH_SECRET in your production environment.'
      )
    }
    return 'libroo-dev-secret'
  }
  return secret
}

const getAuthUrl = () => {
  let url = process.env.BETTER_AUTH_URL

  try {
    if (typeof useRuntimeConfig === 'function') {
      const config = useRuntimeConfig()
      if (config.betterAuthUrl) {
        url = config.betterAuthUrl
      }
    }
  } catch {
    // Ignore error
  }

  return url || 'http://localhost:3000'
}

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
