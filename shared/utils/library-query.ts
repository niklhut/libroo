export type LibraryLoanFilter = 'all' | 'available' | 'loaned'
export type LibraryReadingFilter = 'all' | 'unread' | 'reading' | 'read'
export type LibrarySort = 'dateAdded' | 'title' | 'author' | 'locationPath'

export interface LibraryQueryFilters {
  search?: string
  loanStatus?: LibraryLoanFilter
  readingStatus?: LibraryReadingFilter
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

const loanFilters = new Set<LibraryLoanFilter>(['all', 'available', 'loaned'])
const readingFilters = new Set<LibraryReadingFilter>(['all', 'unread', 'reading', 'read'])
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
  const sortBy = firstString(query.sortBy)

  return {
    page,
    pageSize,
    search: cleanText(query.search),
    loanStatus: loanFilters.has(loanStatus as LibraryLoanFilter)
      ? loanStatus as LibraryLoanFilter
      : 'all',
    readingStatus: readingFilters.has(readingStatus as LibraryReadingFilter)
      ? readingStatus as LibraryReadingFilter
      : 'all',
    tag: cleanText(query.tag),
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
  if (state.loanStatus && state.loanStatus !== 'all') query.loanStatus = state.loanStatus
  if (state.readingStatus && state.readingStatus !== 'all') query.readingStatus = state.readingStatus
  if (state.tag) query.tag = state.tag
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
    state.loanStatus && state.loanStatus !== 'all',
    state.readingStatus && state.readingStatus !== 'all',
    state.tag?.trim(),
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
  if (state.loanStatus && state.loanStatus !== 'all') {
    labels.push(state.loanStatus === 'loaned' ? 'Loaned out' : 'Available')
  }
  if (state.readingStatus && state.readingStatus !== 'all') {
    labels.push(`Reading: ${state.readingStatus}`)
  }
  if (state.tag?.trim()) labels.push(`Tag: ${state.tag.trim()}`)
  if (state.location?.trim()) labels.push(`Location search: ${state.location.trim()}`)
  if (state.locationId) labels.push(`Location: ${options.locationLabel || 'selected'}`)
  if (state.includeLocationDescendants) labels.push('Includes sub-locations')
  if (state.sortBy && state.sortBy !== 'dateAdded') labels.push(`Sort: ${state.sortBy}`)
  if (state.groupByLocation) labels.push('Grouped by location')

  return labels
}
