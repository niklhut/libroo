import { Effect } from 'effect'

export default effectHandler((event, _user) =>
  Effect.gen(function* () {
    // Read request body
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, bookIsbnSchema.parse),
      catch: e => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })

    // Lookup book via BookService (handles local DB check and OpenLibrary fallback)
    return yield* lookupBook(body.isbn)
  })
)
