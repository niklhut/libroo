export function configuredLegalUrl(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}
