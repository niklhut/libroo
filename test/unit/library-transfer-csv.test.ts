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
      library_state: 'wishlisted',
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
      library_state: 'wishlisted',
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

  it('accepts a UTF-8 BOM before the first header cell', () => {
    const csv = `\uFEFFtitle,authors,isbn,tags,location,library_state,reading_status,current_page,progress_percent,rating,note,added_date,active_loan_status,active_loan_borrower,active_loan_loaned_at,active_loan_due_at
Dune,["Frank Herbert"],9780441172719,[],Shelf,owned,read,,100,5,,2026-06-12T10:00:00.000Z,,,,`

    expect(parseLibraryCsv(csv)[0]?.title).toBe('Dune')
  })

  it('accepts legacy CSVs without library_state as owned-compatible blanks', () => {
    const csv = `title,authors,isbn,tags,location,reading_status,current_page,progress_percent,rating,note,added_date,active_loan_status,active_loan_borrower,active_loan_loaned_at,active_loan_due_at
Dune,["Frank Herbert"],9780441172719,[],Shelf,read,,100,5,,2026-06-12T10:00:00.000Z,,,,`

    expect(parseLibraryCsv(csv)[0]).toMatchObject({
      title: 'Dune',
      library_state: ''
    })
  })
})
