import { describe, it, expect } from 'vitest'
import {
  normalizeSuggestedTags,
  normalizeSystemTagSegment,
  splitHierarchicalSubject,
  toSensibleTitleCase,
  normalizeTagInput
} from '../../shared/utils/tag-ingestion'

describe('tag ingestion', () => {
  it('splits hierarchical subjects by slash, double-dash, and colon', () => {
    expect(splitHierarchicalSubject('Fiction / Thrillers / Suspense')).toEqual([
      'Fiction',
      'Thrillers',
      'Suspense'
    ])

    expect(splitHierarchicalSubject('History -- Europe : France')).toEqual([
      'History',
      'Europe',
      'France'
    ])
  })

  it('normalizes uppercase strings to title case', () => {
    expect(toSensibleTitleCase('MYSTERY & DETECTIVE')).toBe('Mystery & Detective')
    expect(normalizeTagInput('TRUE CRIME')?.displayName).toBe('True Crime')
    expect(normalizeSystemTagSegment('SCIENCE FICTION')?.displayName).toBe('Science Fiction')
  })

  it('filters vague segments and keeps useful descendants', () => {
    const result = normalizeSuggestedTags(['Fiction / THRILLERS / Suspense'])
    expect(result.map(tag => tag.displayName)).toEqual(['Thrillers', 'Suspense'])
  })

  it('discards format artifacts, provider metadata, and admin codes', () => {
    expect(normalizeSystemTagSegment('Electronic Resource')).toBeNull()
    expect(normalizeSystemTagSegment('Open Library Curated')).toBeNull()
    expect(normalizeSystemTagSegment('LCSH catalogs')).toBeNull()
  })

  it('discards numeric junk and call numbers', () => {
    expect(normalizeSystemTagSegment('823.914')).toBeNull()
    expect(normalizeSystemTagSegment('PS3563 .A')).toBeNull()
  })

  it('applies structural limits', () => {
    expect(normalizeSystemTagSegment('AI')).toBeNull()
    expect(normalizeSystemTagSegment('Art')?.displayName).toBe('Art')
    expect(normalizeSystemTagSegment('x'.repeat(41))).toBeNull()
    expect(normalizeSystemTagSegment('http://example.com')).toBeNull()
  })

  it('de-duplicates case-insensitively and limits to 20', () => {
    const values = [
      'Mystery / mystery / MYSTERY',
      ...Array.from({ length: 30 }, (_, i) => `Topic ${i + 1}`)
    ]

    const result = normalizeSuggestedTags(values)
    expect(result[0]?.displayName).toBe('Mystery')
    expect(result.length).toBe(20)
    expect(result.filter(tag => tag.key === 'mystery')).toHaveLength(1)
  })
})
