import { enrichImportedBooks } from '../../server/services/book-enrichment.service'
import { runEffect } from '../../server/utils/effect'

export default defineTask({
  meta: {
    name: 'books:enrich-imported',
    description: 'Enrich opted-in CSV imports with Open Library metadata and covers.'
  },
  run: async () => {
    const result = await runEffect(enrichImportedBooks())

    console.info('Imported book enrichment sweep completed', result)
    return { result }
  }
})
