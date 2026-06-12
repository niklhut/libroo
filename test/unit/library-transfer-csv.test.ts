import { describe, expect, it } from 'vitest'
import { escapeCsvValue, formatCsvList, formatLibraryCsv, parseCsvList, parseLibraryCsv } from '../../shared/utils/library-transfer-csv'

describe('library transfer CSV', () => {
  it('escapes commas, quotes, newlines, and missing values', () => {
    expect(escapeCsvValue('A, B')).toBe('"A, B"')
    expect(escapeCsvValue('A "quoted" title')).toBe('"A ""quoted"" title"')
    expect(escapeCsvValue('line 1\nline 2')).toBe('"line 1\nline 2"')
    expect(escapeCsvValue(null)).toBe('')
  })

  it('round trips exported rows', () => {
    const csv = formatLibraryCsv([{
      title: 'The Left Hand, of "Darkness"',
      authors: 'Ursula K. Le Guin',
      isbn: '9780441478125',
      tags: 'sci-fi; classic',
      location: 'Living Room - Shelf 1',
      reading_status: 'read',
      current_page: '',
      progress_percent: '100',
      rating: '5',
      note: 'Cold planet\nwarm book',
      added_date: '2026-06-12T10:00:00.000Z',
      active_loan_status: 'loaned',
      active_loan_borrower: 'Ada, Jr.',
      active_loan_loaned_at: '2026-06-01T10:00:00.000Z',
      active_loan_due_at: ''
    }])

    expect(parseLibraryCsv(csv)).toEqual([{
      title: 'The Left Hand, of "Darkness"',
      authors: 'Ursula K. Le Guin',
      isbn: '9780441478125',
      tags: 'sci-fi; classic',
      location: 'Living Room - Shelf 1',
      reading_status: 'read',
      current_page: '',
      progress_percent: '100',
      rating: '5',
      note: 'Cold planet\nwarm book',
      added_date: '2026-06-12T10:00:00.000Z',
      active_loan_status: 'loaned',
      active_loan_borrower: 'Ada, Jr.',
      active_loan_loaned_at: '2026-06-01T10:00:00.000Z',
      active_loan_due_at: ''
    }])
  })

  it('round trips list fields with semicolons in values', () => {
    const authors = ['Doe; Jane', 'Ursula K. Le Guin']
    const encoded = formatCsvList(authors)

    expect(parseCsvList(encoded)).toEqual(authors)
    expect(parseCsvList('classic; sci-fi')).toEqual(['classic', 'sci-fi'])
  })
})
