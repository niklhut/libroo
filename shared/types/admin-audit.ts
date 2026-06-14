export type AdminAuditAction
  = | 'user.role_changed'
    | 'user.banned'
    | 'user.unbanned'
    | 'signup_invite.created'
    | 'signup_invite.revoked'
    | 'auth.sign_up'
    | 'auth.sign_in_failed'
    | 'auth.password_changed'
    | 'auth.password_reset_requested'
    | 'auth.password_reset_completed'
    | 'auth.email_change_requested'
    | 'auth.email_change_confirmed'
    | 'auth.account_deletion_requested'
    | 'auth.account_deleted'
    | 'auth.session_revoked'
    | 'auth.sessions_revoked'
    | 'auth.two_factor_enabled'
    | 'auth.two_factor_disabled'
    | 'auth.backup_codes_regenerated'
    | 'auth.backup_code_used'

export type AdminAuditCategory = 'admin' | 'auth'

export interface AdminAuditEntry {
  id: string
  category: AdminAuditCategory
  actorUserId: string | null
  actor: AdminAuditUserSummary | null
  targetUserId: string | null
  target: AdminAuditUserSummary | null
  action: AdminAuditAction
  metadata: Record<string, unknown> | null
  createdAt: string | Date
}

export interface AdminAuditUserSummary {
  id: string
  name: string
  email: string
}

export interface AdminAuditLogPage {
  entries: AdminAuditEntry[]
  total: number
  page: number
  pageSize: number
}
