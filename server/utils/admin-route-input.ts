const DEFAULT_ADMIN_PAGE_SIZE = 25
const MAX_ADMIN_PAGE_SIZE = 100

export function normalizeAdminPagination(query: Record<string, unknown>) {
  return {
    page: parsePositiveInteger(query.page, 1),
    pageSize: Math.min(MAX_ADMIN_PAGE_SIZE, parsePositiveInteger(query.pageSize, DEFAULT_ADMIN_PAGE_SIZE))
  }
}

export function normalizeOptionalString(value: unknown) {
  return typeof value === 'string' ? value.trim() : value
}

function parsePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}
