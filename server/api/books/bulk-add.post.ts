import { Effect, Either } from 'effect'
import { z } from 'zod'

const bulkAddSchema = z.object({
  isbns: z.array(z.string().min(10).max(13)).min(1).max(20)
})

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    // Read request body
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, bulkAddSchema.parse),
      catch: e => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })

    const userId = user.id
    const added: Array<{ isbn: string }> = []
    const failed: Array<{ isbn: string, error: string }> = []

    // Add books with concurrency of 3 to balance speed vs resource usage
    const results = yield* Effect.forEach(
      body.isbns,
      (isbn: string) => Effect.either(addBookToLibrary(userId, isbn).pipe(
        Effect.map(() => ({ isbn, success: true as const }))
      )),
      { concurrency: 3 }
    )

    // Process results
    results.forEach((result, index) => {
      const isbn = body.isbns[index]!
      if (Either.isRight(result)) {
        added.push({ isbn })
      } else {
        const error = result.left
        const message = '_tag' in error ? String(error._tag) : 'Unknown error'
        failed.push({ isbn, error: message })
      }
    })

    return { added, failed }
  })
)
