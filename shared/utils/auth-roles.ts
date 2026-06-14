export function parseRoleValues(role: string | string[] | null | undefined): string[] {
  const values = Array.isArray(role) ? role : [role ?? 'user']
  return values.flatMap(value => value.split(',')).map(part => part.trim()).filter(Boolean)
}

export function roleIncludesAdmin(role: string | string[] | null | undefined) {
  return parseRoleValues(role).includes('admin')
}
