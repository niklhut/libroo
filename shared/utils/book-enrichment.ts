import type { BookEnrichmentStatus, BookEnrichmentUiStatus } from '../types/book'

export function toBookEnrichmentUiStatus(
  status: BookEnrichmentStatus | undefined
): BookEnrichmentUiStatus | null {
  if (status === 'pending') return 'queued'
  if (status === 'processing') return 'preparing'
  if (status === 'retrying') return 'retrying'
  if (status === 'no_cover' || status === 'not_found' || status === 'failed') return status
  return null
}
