export type SignupInviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked'

export interface SignupInvite {
  id: string
  email: string | null
  status: SignupInviteStatus
  createdByUserId: string
  acceptedByUserId: string | null
  expiresAt: string | Date
  acceptedAt: string | Date | null
  revokedAt: string | Date | null
  createdAt: string | Date
  updatedAt: string | Date
  inviteUrl?: string
}

export interface SignupInviteCreateResult {
  invite: SignupInvite
  token: string
  inviteUrl: string
}

export interface SignupInviteList {
  invites: SignupInvite[]
  total: number
  page: number
  pageSize: number
}

export interface SignupInvitePreview {
  email: string | null
  status: SignupInviteStatus | null
}
