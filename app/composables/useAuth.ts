import { createAuthClient } from 'better-auth/vue'
import { adminClient } from 'better-auth/client/plugins'

export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server
    ? { ...useRequestHeaders(['cookie']), origin: url.origin }
    : undefined

  return createAuthClient({
    baseURL: url.origin,
    fetchOptions: { headers },
    plugins: [
      adminClient()
    ]
  })
}
