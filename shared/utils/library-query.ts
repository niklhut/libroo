export type LibraryLoanFilter = 'all' | 'available' | 'loaned'
export type LibraryReadingFilter = 'all' | 'unread' | 'reading' | 'read'

export interface LibraryQueryFilters {
  search?: string
  loanStatus?: LibraryLoanFilter
  readingStatus?: LibraryReadingFilter
  tag?: string
  location?: string
}

export interface LibraryQueryState extends LibraryQueryFilters {
  page: number
  pageSize: number
}

export const DEFAULT_LIBRARY_PAGE_SIZE = 12

const loanFilters = new Set<LibraryLoanFilter>(['all', 'available', 'loaned'])
const readingFilters = new Set<LibraryReadingFilter>(['all', 'unread', 'reading', 'read'])

const firstString = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return firstString(value[0])
  return typeof value === 'string' ? value : undefined
}

const cleanText = (value: unknown): string | undefined => {
  const text = firstString(value)?.trim()
  return text || undefined
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
    location: cleanText(query.location)
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

  return query
}
