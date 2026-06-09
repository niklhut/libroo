export const BOOK_LOCATION_MAX_LENGTH = 240
export const BOOK_LOCATION_NAME_MAX_LENGTH = 120

export function normalizeBookLocationName(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null

  const normalized = input.trim().replace(/\s+/g, ' ')
  return normalized.length > 0 ? normalized : null
}

export function normalizeBookLocationKey(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function joinBookLocationPath(parts: string[]): string {
  return parts.map(part => normalizeBookLocationName(part)).filter(Boolean).join(' - ')
}

export function normalizeBookLocationPath(input: string | string[] | null | undefined): string | null {
  if (input === null || input === undefined) return null

  const parts = Array.isArray(input)
    ? input
    : input.split(/\s+[-–—]\s+|[/>]/g)

  const normalizedParts = parts
    .map(part => normalizeBookLocationName(part))
    .filter(Boolean)

  if (normalizedParts.length === 0) return null

  return normalizedParts.join(' - ')
}
