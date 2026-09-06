export interface AuthCapabilities {
  twoFactorEnabled: boolean
  passkeysEnabled: boolean
  emailPasswordEnabled: boolean
  oauthProvider: {
    enabled: true
    providerId: string
    displayName: string
    icon?: string
  } | null
}
