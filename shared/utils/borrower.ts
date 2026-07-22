export const BORROWER_SUGGESTION_MIN_QUERY_LENGTH = 2
export const BORROWER_SUGGESTION_LIMIT = 8

export function normalizeBorrowerName(value: string): string {
  return value.trim().toLowerCase()
}

export function normalizeBorrowerEmail(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase()
  return normalized || null
}
