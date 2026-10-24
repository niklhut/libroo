import { Effect, Result } from 'effect'
import { enrichImportedBooks } from '../../server/services/book-enrichment.service'
import { recoverCanonicalEnrichment } from '../../server/services/book.service'
import { runEffect } from '../../server/utils/effect'

export default defineTask({
  meta: {
    name: 'books:enrich-imported',
    description: 'Enrich opted-in CSV imports with Open Library metadata and covers.'
  },
  run: async () => {
    const sweepId = crypto.randomUUID()
    const [imported, canonical] = await Promise.all([
      runEffect(Effect.result(enrichImportedBooks())),
      runEffect(Effect.result(recoverCanonicalEnrichment(20)))
    ])
    if (Result.isFailure(imported)) {
      console.error('Imported book enrichment sweep failed', { sweepId, error: imported.failure })
    }
    if (Result.isFailure(canonical)) {
      console.error('Canonical enrichment recovery failed', { sweepId, error: canonical.failure })
    }
    const result = Result.isSuccess(imported) ? imported.success : null
    const canonicalRecovery = Result.isSuccess(canonical) ? canonical.success : null
    console.info('Book enrichment sweep completed', { sweepId, result, canonicalRecovery })
    return { result, canonicalRecovery }
  }
})
