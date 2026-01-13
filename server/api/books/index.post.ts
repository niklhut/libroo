import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, bookIsbnSchema.parse),
      catch: e => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })

    // Add book by ISBN via BookService
    return yield* addBookToLibrary(user.id, body.isbn)
  })
)
