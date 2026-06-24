import { createAuthClient } from 'better-auth/vue'
import { adminClient } from 'better-auth/client/plugins'

export function createRequestAuthClient(origin: string, headers: Record<string, string> = {}) {
  return createAuthClient({
    baseURL: origin,
    fetchOptions: {
      headers: {
        ...headers,
        origin
      }
    },
    plugins: [
      adminClient()
    ]
  })
}

export function useAuth() {
  const url = useRequestURL()
  const headers = import.meta.server ? useRequestHeaders(['cookie']) : {}

  return createRequestAuthClient(url.origin, headers)
}
