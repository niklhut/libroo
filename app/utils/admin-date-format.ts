const adminDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC'
})

export function formatAdminDateTime(value: string | Date | null | undefined) {
  if (!value) return 'Never'
  return adminDateTimeFormatter.format(new Date(value))
}
