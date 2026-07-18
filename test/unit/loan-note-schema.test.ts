import { describe, expect, it } from 'vitest'
import { createLoanSchema, loanNoteSchema } from '../../shared/utils/schemas'
import { LOAN_NOTE_MAX_LENGTH } from '../../shared/utils/loan'

describe('loan note schemas', () => {
  it('trims empty loan notes to null', () => {
    expect(loanNoteSchema.parse({ note: '  ' })).toEqual({ note: null })
    expect(createLoanSchema.parse({ borrowerDisplayName: 'Grace', note: '  ' }).note).toBeNull()
  })

  it('rejects notes above the shared cap', () => {
    expect(() => loanNoteSchema.parse({ note: 'x'.repeat(LOAN_NOTE_MAX_LENGTH + 1) })).toThrow()
    expect(() => createLoanSchema.parse({ borrowerDisplayName: 'Grace', note: 'x'.repeat(LOAN_NOTE_MAX_LENGTH + 1) })).toThrow()
  })
})
