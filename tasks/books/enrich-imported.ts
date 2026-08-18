import { Effect, Either } from 'effect'
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
      runEffect(Effect.either(enrichImportedBooks())),
      runEffect(Effect.either(recoverCanonicalEnrichment(20)))
    ])
    if (Either.isLeft(imported)) {
      console.error('Imported book enrichment sweep failed', { sweepId, error: imported.left })
    }
    if (Either.isLeft(canonical)) {
      console.error('Canonical enrichment recovery failed', { sweepId, error: canonical.left })
    }
    const result = Either.isRight(imported) ? imported.right : null
    const canonicalRecovery = Either.isRight(canonical) ? canonical.right : null
    console.info('Book enrichment sweep completed', { sweepId, result, canonicalRecovery })
    return { result, canonicalRecovery }
  }
})
