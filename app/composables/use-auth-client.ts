import { createAuthClient } from 'better-auth/client'

export const useAuthClient = () => {
  return createAuthClient({
    plugins: []
  })
}
