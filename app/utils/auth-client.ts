import { createAuthClient } from 'better-auth/vue'
import { adminClient, twoFactorClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'

export const authClient = createAuthClient({
  plugins: [
    adminClient(),
    twoFactorClient(),
    passkeyClient()
  ]
})
