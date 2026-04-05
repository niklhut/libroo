export interface PaginationParams {
  page: number
  pageSize: number
  search?: string
}

export interface PaginatedResult<T> {
  items: T[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
    hasMore: boolean
  }
}
