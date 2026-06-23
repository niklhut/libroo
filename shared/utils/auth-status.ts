export interface AuthStatusUser extends Record<string, unknown> {
  banned?: boolean | null
  banExpires?: string | Date | null
}

export function isActiveBan(user: AuthStatusUser) {
  if (!user.banned) return false
  if (!user.banExpires) return true

  const banExpires = user.banExpires instanceof Date ? user.banExpires : new Date(user.banExpires)
  return !Number.isFinite(banExpires.getTime()) || banExpires.getTime() > Date.now()
}
