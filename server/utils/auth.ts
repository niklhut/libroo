import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import * as schema from 'hub:db:schema'
import { useDrizzle } from './drizzle'

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  secret: process.env.BETTER_AUTH_SECRET || 'libroo-dev-secret-change-in-production',
  database: drizzleAdapter(useDrizzle(), {
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
