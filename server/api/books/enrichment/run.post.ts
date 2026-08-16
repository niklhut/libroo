import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, runBookEnrichmentSchema.parse),
      catch: error => createError({ statusCode: 400, message: 'Validation Error', data: error })
    })
    return yield* enrichOpenLibraryBook(user.id, body.bookId)
  })
)
