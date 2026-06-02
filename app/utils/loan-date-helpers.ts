export function formatDate(value: Date | string | null): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

export function returnedLabel(value: Date | string | null): string {
  const formatted = formatDate(value)
  return formatted ? `Returned ${formatted}` : 'Returned'
}
