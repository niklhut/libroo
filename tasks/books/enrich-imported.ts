import { enrichImportedBooks } from '../../server/services/book-enrichment.service'
import { runEffect } from '../../server/utils/effect'

export default defineTask({
  meta: {
    name: 'books:enrich-imported',
    description: 'Enrich opted-in CSV imports with Open Library metadata and covers.'
  },
  run: async () => {
    const sweepId = crypto.randomUUID()
    try {
      const result = await runEffect(enrichImportedBooks())
      console.info('Imported book enrichment sweep completed', { sweepId, ...result })
      return { result }
    } catch (error) {
      console.error('Imported book enrichment sweep failed', { sweepId, error })
      throw error
    }
  }
})
