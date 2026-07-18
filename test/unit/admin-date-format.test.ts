import { describe, expect, it } from 'vitest'
import { formatAdminDateTime } from '~/utils/admin-date-format'

describe('admin date/time formatting', () => {
  it('uses a fixed locale and a 24-hour clock for a fixed timestamp', () => {
    const formatted = formatAdminDateTime('2026-06-04T12:05:00.000Z')

    expect(formatted).toBe('4 Jun 2026, 12:05')
    expect(formatted).not.toMatch(/AM|PM/i)
  })

  it('formats null and empty timestamps as Never', () => {
    expect(formatAdminDateTime(null)).toBe('Never')
    expect(formatAdminDateTime('')).toBe('Never')
  })
})
