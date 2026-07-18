import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: async () => {
        const rawBody = await readRawBody(event)
        if (!rawBody || new TextEncoder().encode(rawBody).byteLength > MAX_BULK_ISBN_INPUT_BYTES) {
          throw new Error('Bulk ISBN input is empty or too large')
        }
        return bulkBookLookupSchema.parse(JSON.parse(rawBody))
      },
      catch: error => createError({ statusCode: 400, message: 'Validation Error', data: error })
    })

    return yield* bulkLookupBooks(user.id, body.isbns)
  })
)
