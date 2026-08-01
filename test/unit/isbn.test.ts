import { describe, expect, it } from 'vitest'
import {
  isbnIdentityAliases,
  isValidIsbn,
  normalizeIsbnIdentity
} from '../../shared/utils/isbn'

describe('ISBN identity', () => {
  it('uses the ISBN-13 equivalent as the canonical identity for ISBN-10', () => {
    expect(normalizeIsbnIdentity('0-441-17271-7')).toBe('9780441172719')
    expect(isbnIdentityAliases('0-441-17271-7')).toEqual([
      '9780441172719',
      '0441172717'
    ])
    expect(isbnIdentityAliases('978-0-441-17271-9')).toEqual([
      '9780441172719',
      '0441172717'
    ])
  })

  it('validates checksums and leaves non-ISBN identifiers normalized but distinct', () => {
    expect(isValidIsbn('0-8044-2957-X')).toBe(true)
    expect(isValidIsbn('9780441172719')).toBe(true)
    expect(isValidIsbn('9780441172718')).toBe(false)
    expect(normalizeIsbnIdentity(' custom-id ')).toBe('CUSTOMID')
    expect(isbnIdentityAliases(' custom-id ')).toEqual(['CUSTOMID'])
  })
})
