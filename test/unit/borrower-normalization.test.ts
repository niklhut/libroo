import { describe, expect, it } from 'vitest'
import { normalizeBorrowerEmail, normalizeBorrowerName } from '../../shared/utils/borrower'
import { borrowerSuggestionQuerySchema } from '../../shared/utils/schemas'

describe('borrower suggestion normalization', () => {
  it('normalizes names and emails without changing display values', () => {
    expect(normalizeBorrowerName('  Grace Hopper  ')).toBe('grace hopper')
    expect(normalizeBorrowerEmail('  GRACE@Example.com  ')).toBe('grace@example.com')
  })

  it('normalizes empty emails to null', () => {
    expect(normalizeBorrowerEmail('   ')).toBeNull()
    expect(normalizeBorrowerEmail(null)).toBeNull()
    expect(normalizeBorrowerEmail(undefined)).toBeNull()
  })

  it('trims suggestion query input', () => {
    expect(borrowerSuggestionQuerySchema.parse({ query: '  gr  ' })).toEqual({ query: 'gr' })
  })
})
