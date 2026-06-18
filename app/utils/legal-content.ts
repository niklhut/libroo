export function configuredLegalUrl(value: unknown): string {
  if (typeof value !== 'string') return ''

  const url = value.trim()
  if (!url) return ''

  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : ''
  } catch {
    return ''
  }
}
