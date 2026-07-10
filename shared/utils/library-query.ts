import type { LibraryState } from '../types/book'

export type LibraryLoanFilter = 'all' | 'available' | 'loaned'
export type LibraryReadingFilter = 'all' | 'unread' | 'reading' | 'read'
export type LibraryStateFilter = LibraryState[]
export type LibrarySort = 'dateAdded' | 'title' | 'author' | 'locationPath'

export interface LibraryQueryFilters {
  search?: string
  libraryState?: LibraryStateFilter
  loanStatus?: LibraryLoanFilter
  readingStatus?: LibraryReadingFilter
  /**
   * Canonical multi-tag filter. The legacy `tag` field is accepted on input
   * for old links/callers and folded into this list during normalization.
   */
  tags?: string[]
  tag?: string
  location?: string
  locationId?: string
  includeLocationDescendants?: boolean
  sortBy?: LibrarySort
}

export interface LibraryQueryState extends LibraryQueryFilters {
  page: number
  pageSize: number
}

export interface LibraryFilterSummaryState extends LibraryQueryFilters {
  groupByLocation?: boolean
}

export interface LibraryFilterSummaryOptions {
  includeSearch?: boolean
  locationLabel?: string
}

export const DEFAULT_LIBRARY_PAGE_SIZE = 12
export const DEFAULT_LIBRARY_STATE_FILTER: LibraryStateFilter = ['owned']

const loanFilters = new Set<LibraryLoanFilter>(['all', 'available', 'loaned'])
const readingFilters = new Set<LibraryReadingFilter>(['all', 'unread', 'reading', 'read'])
export const libraryStateFilters = new Set<LibraryState>(['owned', 'wishlisted', 'previously_owned'])
export const libraryStateLabels = {
  owned: 'Library',
  wishlisted: 'Wishlist',
  previously_owned: 'Previously owned'
} satisfies Record<LibraryState, string>
export const libraryStateFilterValues = [...libraryStateFilters]
const sortOptions = new Set<LibrarySort>(['dateAdded', 'title', 'author', 'locationPath'])

const firstString = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return firstString(value[0])
  return typeof value === 'string' ? value : undefined
}

const cleanText = (value: unknown): string | undefined => {
  const text = firstString(value)?.trim()
  return text || undefined
}

const cleanBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') return value
  const text = firstString(value)?.trim().toLowerCase()
  if (text === 'true' || text === '1') return true
  if (text === 'false' || text === '0') return false
  return undefined
}

const valuesAsStrings = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(valuesAsStrings)
  if (typeof value !== 'string') return []
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

const normalizeTagFilter = (value: unknown): string[] => {
  const seen = new Set<string>()
  return valuesAsStrings(value).map(tag => tag.toLowerCase()).filter((normalized) => {
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

export const normalizeLibraryStateFilter = (value: unknown): LibraryStateFilter => {
  const states: LibraryState[] = []
  const seen = new Set<LibraryState>()

  for (const item of valuesAsStrings(value)) {
    if (item === 'all') return []
    if (!libraryStateFilters.has(item as LibraryState)) continue
    const state = item as LibraryState
    if (seen.has(state)) continue
    seen.add(state)
    states.push(state)
  }

  return states
}

export const hasLibraryStateFilter = (state?: LibraryStateFilter): boolean =>
  Boolean(state && state.length > 0 && state.length < libraryStateFilters.size)

export const normalizeLibraryQuery = (
  query: Record<string, unknown>,
  options: { defaultPageSize?: number, maxPageSize?: number } = {}
): LibraryQueryState => {
  const defaultPageSize = options.defaultPageSize ?? DEFAULT_LIBRARY_PAGE_SIZE
  const maxPageSize = options.maxPageSize ?? 100
  const page = Math.max(1, parseInt(firstString(query.page) || '', 10) || 1)
  const pageSize = Math.min(
    maxPageSize,
    Math.max(1, parseInt(firstString(query.pageSize) || '', 10) || defaultPageSize)
  )
  const loanStatus = firstString(query.loanStatus)
  const readingStatus = firstString(query.readingStatus)
  const libraryState = normalizeLibraryStateFilter(query.libraryState)
  // `tags` takes precedence over the legacy single `tag` query parameter.
  const tags = normalizeTagFilter(query.tags ?? query.tag)
  const sortBy = firstString(query.sortBy)

  return {
    page,
    pageSize,
    search: cleanText(query.search),
    libraryState,
    loanStatus: loanFilters.has(loanStatus as LibraryLoanFilter)
      ? loanStatus as LibraryLoanFilter
      : 'all',
    readingStatus: readingFilters.has(readingStatus as LibraryReadingFilter)
      ? readingStatus as LibraryReadingFilter
      : 'all',
    tags,
    location: cleanText(query.location),
    locationId: cleanText(query.locationId),
    includeLocationDescendants: cleanBoolean(query.includeLocationDescendants) ?? false,
    sortBy: sortOptions.has(sortBy as LibrarySort) ? sortBy as LibrarySort : 'dateAdded'
  }
}

export const buildLibraryRouteQuery = (state: LibraryQueryState): Record<string, string> => {
  const query: Record<string, string> = {
    page: String(state.page)
  }

  if (state.pageSize !== DEFAULT_LIBRARY_PAGE_SIZE) query.pageSize = String(state.pageSize)
  if (state.search) query.search = state.search
  if (hasLibraryStateFilter(state.libraryState)) query.libraryState = state.libraryState!.join(',')
  if (state.loanStatus && state.loanStatus !== 'all') query.loanStatus = state.loanStatus
  if (state.readingStatus && state.readingStatus !== 'all') query.readingStatus = state.readingStatus
  if (state.tags?.length) query.tags = state.tags.join(',')
  if (state.location) query.location = state.location
  if (state.locationId) query.locationId = state.locationId
  if (state.includeLocationDescendants) query.includeLocationDescendants = 'true'
  if (state.sortBy && state.sortBy !== 'dateAdded') query.sortBy = state.sortBy

  return query
}

export const getActiveLibraryFilterCount = (
  state: LibraryFilterSummaryState,
  options: { includeSearch?: boolean } = {}
): number => {
  const advancedFilters = [
    hasLibraryStateFilter(state.libraryState),
    state.loanStatus && state.loanStatus !== 'all',
    state.readingStatus && state.readingStatus !== 'all',
    state.tags?.length || state.tag?.trim(),
    state.location?.trim(),
    state.locationId,
    state.includeLocationDescendants,
    state.sortBy && state.sortBy !== 'dateAdded',
    state.groupByLocation
  ]

  return advancedFilters.filter(Boolean).length + (options.includeSearch && state.search?.trim() ? 1 : 0)
}

export const describeActiveLibraryFilters = (
  state: LibraryFilterSummaryState,
  options: LibraryFilterSummaryOptions = {}
): string[] => {
  const labels: string[] = []

  if (options.includeSearch && state.search?.trim()) labels.push(`Search: ${state.search.trim()}`)
  if (hasLibraryStateFilter(state.libraryState)) {
    labels.push(...state.libraryState!.map(item => libraryStateLabels[item]))
  }
  if (state.loanStatus && state.loanStatus !== 'all') {
    labels.push(state.loanStatus === 'loaned' ? 'Loaned out' : 'Available')
  }
  if (state.readingStatus && state.readingStatus !== 'all') {
    labels.push(`Reading: ${state.readingStatus}`)
  }
  const tags = state.tags?.length ? state.tags : state.tag?.trim() ? [state.tag.trim()] : []
  if (tags.length) labels.push(`Tags: ${tags.join(', ')}`)
  if (state.location?.trim()) labels.push(`Location search: ${state.location.trim()}`)
  if (state.locationId) labels.push(`Location: ${options.locationLabel || 'selected'}`)
  if (state.includeLocationDescendants) labels.push('Includes sub-locations')
  if (state.sortBy && state.sortBy !== 'dateAdded') labels.push(`Sort: ${state.sortBy}`)
  if (state.groupByLocation) labels.push('Grouped by location')

  return labels
}
