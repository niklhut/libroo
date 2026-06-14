import { describe, expect, it } from 'vitest'
import {
  buildLibraryRouteQuery,
  describeActiveLibraryFilters,
  getActiveLibraryFilterCount,
  normalizeLibraryQuery
} from '../../shared/utils/library-query'

describe('library query helpers', () => {
  it('normalizes pagination, search, and filter query params', () => {
    expect(normalizeLibraryQuery({
      page: '-2',
      pageSize: '500',
      search: '  dune  ',
      loanStatus: 'loaned',
      readingStatus: 'reading',
      tag: '  sci-fi ',
      location: ' shelf b ',
      locationId: ' loc-1 ',
      includeLocationDescendants: 'true',
      sortBy: 'locationPath'
    })).toEqual({
      page: 1,
      pageSize: 100,
      search: 'dune',
      loanStatus: 'loaned',
      readingStatus: 'reading',
      tag: 'sci-fi',
      location: 'shelf b',
      locationId: 'loc-1',
      includeLocationDescendants: true,
      sortBy: 'locationPath'
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
      location: undefined,
      locationId: undefined,
      includeLocationDescendants: false,
      sortBy: 'dateAdded'
    })
  })

  it('accepts native boolean query values', () => {
    expect(normalizeLibraryQuery({
      includeLocationDescendants: true
    })).toMatchObject({
      includeLocationDescendants: true
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
      location: undefined,
      locationId: 'loc-1',
      includeLocationDescendants: true,
      sortBy: 'author'
    })).toEqual({
      page: '1',
      search: 'dune',
      loanStatus: 'available',
      tag: 'classic',
      locationId: 'loc-1',
      includeLocationDescendants: 'true',
      sortBy: 'author'
    })
  })

  it('counts hidden advanced filters separately from primary search', () => {
    expect(getActiveLibraryFilterCount({
      search: 'dune',
      loanStatus: 'all',
      readingStatus: 'all',
      sortBy: 'dateAdded'
    })).toBe(0)

    expect(getActiveLibraryFilterCount({
      search: 'dune',
      loanStatus: 'loaned',
      readingStatus: 'read',
      tag: 'classic',
      location: 'shelf',
      locationId: 'loc-1',
      includeLocationDescendants: true,
      sortBy: 'author',
      groupByLocation: true
    })).toBe(8)
  })

  it('can include search in active filter counts for full criteria checks', () => {
    expect(getActiveLibraryFilterCount({
      search: 'dune',
      loanStatus: 'all',
      readingStatus: 'all',
      sortBy: 'dateAdded'
    }, {
      includeSearch: true
    })).toBe(1)
  })

  it('describes active advanced filters for collapsed summaries', () => {
    expect(describeActiveLibraryFilters({
      loanStatus: 'available',
      readingStatus: 'reading',
      tag: 'sci-fi',
      locationId: 'loc-1',
      includeLocationDescendants: true,
      sortBy: 'locationPath',
      groupByLocation: true
    }, {
      locationLabel: 'Living Room - Shelf A'
    })).toEqual([
      'Available',
      'Reading: reading',
      'Tag: sci-fi',
      'Location: Living Room - Shelf A',
      'Includes sub-locations',
      'Sort: locationPath',
      'Grouped by location'
    ])
  })
})
