import { Effect } from 'effect'
import { runOwnedCanonicalEnrichmentBatch } from '../../../services/book.service'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, runCanonicalEnrichmentBatchSchema.parse),
      catch: error => createError({ statusCode: 400, message: 'Validation Error', data: error })
    })
    return yield* runOwnedCanonicalEnrichmentBatch(user.id, body.userBookIds)
  })
)
