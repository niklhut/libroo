import { describe, expect, it } from 'vitest'
import {
  buildLibraryRouteQuery,
  DEFAULT_LIBRARY_STATE_FILTER,
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
      libraryState: ['wishlisted'],
      loanStatus: 'loaned',
      readingStatus: 'reading',
      tags: ['  sci-fi, art ', 'fiction'],
      location: ' shelf b ',
      locationId: ' loc-1 ',
      includeLocationDescendants: 'true',
      sortBy: 'locationPath'
    })).toEqual({
      page: 1,
      pageSize: 100,
      search: 'dune',
      libraryState: ['wishlisted'],
      loanStatus: 'loaned',
      readingStatus: 'reading',
      tags: ['sci-fi', 'art', 'fiction'],
      location: 'shelf b',
      locationId: 'loc-1',
      includeLocationDescendants: true,
      sortBy: 'locationPath'
    })
  })

  it('falls back to all library state and all secondary filters when params are unknown', () => {
    expect(normalizeLibraryQuery({
      loanStatus: 'missing',
      libraryState: 'missing',
      readingStatus: 'started',
      search: '   '
    })).toMatchObject({
      search: undefined,
      libraryState: [],
      loanStatus: 'all',
      readingStatus: 'all',
      tags: [],
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

  it('parses repeated and comma-separated library state filters', () => {
    expect(normalizeLibraryQuery({
      libraryState: ['owned,wishlisted', 'previously_owned']
    })).toMatchObject({
      libraryState: ['owned', 'wishlisted', 'previously_owned']
    })

    expect(normalizeLibraryQuery({
      libraryState: ['wishlisted', 'owned']
    })).toMatchObject({
      libraryState: ['wishlisted', 'owned']
    })

    expect(normalizeLibraryQuery({
      libraryState: 'all'
    })).toMatchObject({
      libraryState: []
    })
  })

  it('folds the legacy single tag query into normalized tags', () => {
    expect(normalizeLibraryQuery({ tag: '  Sci-Fi ' })).toMatchObject({
      tags: ['sci-fi']
    })
  })

  it('builds compact route query params', () => {
    expect(buildLibraryRouteQuery({
      page: 1,
      pageSize: 12,
      search: 'dune',
      libraryState: [],
      loanStatus: 'available',
      readingStatus: 'all',
      tags: ['classic', 'art'],
      location: undefined,
      locationId: 'loc-1',
      includeLocationDescendants: true,
      sortBy: 'author'
    })).toEqual({
      page: '1',
      search: 'dune',
      loanStatus: 'available',
      tags: 'classic,art',
      locationId: 'loc-1',
      includeLocationDescendants: 'true',
      sortBy: 'author'
    })
  })

  it('counts hidden advanced filters separately from primary search', () => {
    expect(getActiveLibraryFilterCount({
      search: 'dune',
      libraryState: [],
      loanStatus: 'all',
      readingStatus: 'all',
      sortBy: 'dateAdded'
    })).toBe(0)

    expect(getActiveLibraryFilterCount({
      search: 'dune',
      libraryState: ['wishlisted'],
      loanStatus: 'loaned',
      readingStatus: 'read',
      tags: ['classic'],
      location: 'shelf',
      locationId: 'loc-1',
      includeLocationDescendants: true,
      sortBy: 'author',
      groupByLocation: true
    })).toBe(9)

    expect(getActiveLibraryFilterCount({
      libraryState: ['owned', 'wishlisted', 'previously_owned'],
      loanStatus: 'all',
      readingStatus: 'all'
    })).toBe(0)
  })

  it('can include search in active filter counts for full criteria checks', () => {
    expect(getActiveLibraryFilterCount({
      search: 'dune',
      libraryState: [],
      loanStatus: 'all',
      readingStatus: 'all',
      sortBy: 'dateAdded'
    }, {
      includeSearch: true
    })).toBe(1)
  })

  it('describes active advanced filters for collapsed summaries', () => {
    expect(describeActiveLibraryFilters({
      libraryState: ['owned'],
      tag: 'classic'
    })).toEqual([
      'Library',
      'Tags: classic'
    ])

    expect(describeActiveLibraryFilters({
      loanStatus: 'available',
      libraryState: ['wishlisted'],
      readingStatus: 'reading',
      tags: ['sci-fi', 'art'],
      locationId: 'loc-1',
      includeLocationDescendants: true,
      sortBy: 'locationPath',
      groupByLocation: true
    }, {
      locationLabel: 'Living Room - Shelf A'
    })).toEqual([
      'Wishlist',
      'Available',
      'Reading: reading',
      'Tags: sci-fi, art',
      'Location: Living Room - Shelf A',
      'Includes sub-locations',
      'Sort: locationPath',
      'Grouped by location'
    ])
  })

  it('defaults the UI to Library while preserving All books as an explicit empty filter', () => {
    expect(DEFAULT_LIBRARY_STATE_FILTER).toEqual(['owned'])

    expect(normalizeLibraryQuery({})).toMatchObject({
      libraryState: []
    })

    expect(buildLibraryRouteQuery({
      page: 1,
      pageSize: 12,
      libraryState: [],
      loanStatus: 'all',
      readingStatus: 'all',
      sortBy: 'dateAdded'
    })).toEqual({
      page: '1'
    })

    expect(buildLibraryRouteQuery({
      page: 1,
      pageSize: 12,
      libraryState: ['owned'],
      loanStatus: 'all',
      readingStatus: 'all',
      sortBy: 'dateAdded'
    })).toEqual({
      page: '1',
      libraryState: 'owned'
    })

    expect(buildLibraryRouteQuery({
      page: 1,
      pageSize: 12,
      libraryState: ['owned'],
      loanStatus: 'all',
      readingStatus: 'all',
      sortBy: 'dateAdded'
    })).toEqual({
      page: '1',
      libraryState: 'owned'
    })
  })
})
