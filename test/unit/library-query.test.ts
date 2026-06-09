import { describe, expect, it } from 'vitest'
import { buildLibraryRouteQuery, normalizeLibraryQuery } from '../../shared/utils/library-query'

describe('library query helpers', () => {
  it('normalizes pagination, search, and filter query params', () => {
    expect(normalizeLibraryQuery({
      page: '-2',
      pageSize: '500',
      search: '  dune  ',
      loanStatus: 'loaned',
      readingStatus: 'reading',
      tag: '  sci-fi ',
      location: ' shelf b '
    })).toEqual({
      page: 1,
      pageSize: 100,
      search: 'dune',
      loanStatus: 'loaned',
      readingStatus: 'reading',
      tag: 'sci-fi',
      location: 'shelf b'
    })
  })

  it('falls back to all filters when params are unknown', () => {
    expect(normalizeLibraryQuery({
      loanStatus: 'missing',
      readingStatus: 'started',
      search: '   '
    })).toMatchObject({
      search: undefined,
      loanStatus: 'all',
      readingStatus: 'all',
      tag: undefined,
      location: undefined
    })
  })

  it('builds compact route query params', () => {
    expect(buildLibraryRouteQuery({
      page: 1,
      pageSize: 12,
      search: 'dune',
      loanStatus: 'available',
      readingStatus: 'all',
      tag: 'classic',
      location: undefined
    })).toEqual({
      page: '1',
      search: 'dune',
      loanStatus: 'available',
      tag: 'classic'
    })
  })
})
