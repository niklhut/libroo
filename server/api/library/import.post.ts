import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, libraryImportSchema.parse),
      catch: e => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })

    return yield* importLibraryCsv(user.id, body.csv, body.conflictStrategy)
  })
)
