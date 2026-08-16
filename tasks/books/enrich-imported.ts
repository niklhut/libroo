import { Effect } from 'effect'
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
    try {
      const [result, canonicalRecovery] = await runEffect(Effect.all([
        enrichImportedBooks(),
        recoverCanonicalEnrichment(20)
      ], { concurrency: 1 }))
      console.info('Book enrichment sweep completed', { sweepId, ...result, canonicalRecovery })
      return { result, canonicalRecovery }
    } catch (error) {
      console.error('Imported book enrichment sweep failed', { sweepId, error })
      throw error
    }
  }
})
