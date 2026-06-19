import { describe, expect, it } from 'vitest'
import { appName, formatPageTitle } from '~/utils/page-title'

describe('page title formatting', () => {
  it('uses the app name when a page has no title', () => {
    expect(formatPageTitle()).toBe(appName)
    expect(formatPageTitle(null)).toBe(appName)
    expect(formatPageTitle('')).toBe(appName)
  })

  it('formats section titles with the Libroo suffix', () => {
    expect(formatPageTitle('Library')).toBe('Library · Libroo')
    expect(formatPageTitle('Admin Users')).toBe('Admin Users · Libroo')
    expect(formatPageTitle('Settings')).toBe('Settings · Libroo')
  })

  it('formats dynamic page titles with the same template', () => {
    expect(formatPageTitle('The Anxious Generation')).toBe('The Anxious Generation · Libroo')
    expect(formatPageTitle('Invitation: The Anxious Generation')).toBe('Invitation: The Anxious Generation · Libroo')
  })
})
