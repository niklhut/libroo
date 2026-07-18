export type AdminUserRole = 'admin' | 'user'
export type AdminUserStatus = 'active' | 'banned'

export interface AdminUser {
  id: string
  name: string
  email: string
  createdAt: string | Date
  updatedAt: string | Date
  lastSessionActivityAt: string | Date | null
  role: AdminUserRole
  isAdmin: boolean
  status: AdminUserStatus
  banReason: string | null
  banExpires: string | Date | null
}

export interface AdminUsersPage {
  users: AdminUser[]
  total: number
  page: number
  pageSize: number
}
