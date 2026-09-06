import type { AuthCapabilities } from '~~/shared/types/auth-capabilities'

const defaultAuthCapabilities = (): AuthCapabilities => ({
  twoFactorEnabled: false,
  passkeysEnabled: false,
  emailPasswordEnabled: true,
  oauthProvider: null
})

export function useAuthCapabilities() {
  return useAsyncData<AuthCapabilities>(
    'auth-capabilities',
    () => $fetch('/api/capabilities/auth'),
    { default: defaultAuthCapabilities }
  )
}
