import { describe, expect, it } from 'vitest'
import { normalizeBookLocationName, normalizeBookLocationPath } from '../../shared/utils/book-location'

describe('book location normalization', () => {
  it('normalizes location and sub-location parts with dashes', () => {
    expect(normalizeBookLocationPath([' Living Room ', ' Shelf-B '])).toBe('Living Room - Shelf-B')
  })

  it('normalizes a dashed location string', () => {
    expect(normalizeBookLocationPath('Living Room - Shelf B')).toBe('Living Room - Shelf B')
  })

  it('clears blank locations', () => {
    expect(normalizeBookLocationName('   ')).toBeNull()
  })
})
