import { enrichImportedBooks } from '../services/book-enrichment.service'
import { getBooksEnrichmentConfig } from './books-config'
import { runEffect } from './effect'
import { getWaitUntil } from './execution-context'

export function dispatchBookEnrichment(batchId: string, queuedCount = 1): boolean {
  const waitUntil = getWaitUntil()
  if (!waitUntil) return false

  const limit = Math.min(Math.max(1, queuedCount), getBooksEnrichmentConfig().batchSize)
  const promise = runEffect(enrichImportedBooks({ batchId, limit })).then(
    result => console.info('Imported book enrichment completed', { batchId, ...result }),
    error => console.error('Imported book enrichment failed', { batchId, error })
  )
  waitUntil(promise)
  return true
}
