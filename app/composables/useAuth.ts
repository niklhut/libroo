import { createAuthClient } from 'better-auth/vue'
import { adminClient, twoFactorClient } from 'better-auth/client/plugins'
import { passkeyClient } from '@better-auth/passkey/client'

export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server
    ? { ...useRequestHeaders(['cookie']), origin: url.origin }
    : undefined

  return createAuthClient({
    baseURL: url.origin,
    fetchOptions: { headers },
    plugins: [
      adminClient(),
      twoFactorClient(),
      passkeyClient()
    ]
  })
}
