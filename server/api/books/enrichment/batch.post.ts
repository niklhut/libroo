import { Effect } from 'effect'
import { runOwnedEnrichmentBatch } from '../../../services/book-enrichment.service'
import { getBooksEnrichmentConfig } from '../../../utils/books-config'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, runLibraryEnrichmentBatchSchema.parse),
      catch: error => createError({ statusCode: 400, message: 'Validation Error', data: error })
    })

    return yield* runOwnedEnrichmentBatch(user.id, body.batchId, getBooksEnrichmentConfig().batchSize)
  })
)
