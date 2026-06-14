const truthyValues = new Set(['1', 'true', 'yes', 'on'])
const falseyValues = new Set(['0', 'false', 'no', 'off'])

export function booleanConfigValue(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return fallback

  const normalized = value.trim().toLowerCase()
  if (!normalized) return fallback
  if (truthyValues.has(normalized)) return true
  if (falseyValues.has(normalized)) return false
  return fallback
}
