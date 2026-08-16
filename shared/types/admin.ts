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

export interface AdminMetrics {
  users: number
  library: {
    canonicalBooks: number
    activeUserBooks: number
    activeLoans: number
    locations: number
    tags: number
  }
  storage: AdminStorageMetrics
}

export interface UnknownAuthorRepairStatus {
  candidateCount: number
}

export interface RepairUnknownAuthorsResult {
  scanned: number
  repaired: number
  stillUnknown: number
  skipped: number
  failed: number
}

export type AdminStorageMetrics
  = | { state: 'unavailable' }
    | {
      state: 'stale' | 'ok'
      totalBytes: number
      totalMegabytes: number
      totalGigabytes: number
      objectCount: number
      lastCalculatedAt: string | Date
    }
