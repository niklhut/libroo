import { Effect, Either } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, bookBatchDeleteSchema.parse),
      catch: (e) => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })
    const { ids } = body

    // Process all deletions in parallel (unbounded concurrency)
    // Wrap each operation in Either to capture success/failure individually (like Promise.allSettled)
    const results = yield* Effect.forEach(
      ids,
      (id) => Effect.either(removeFromLibrary(id, user.id)),
      { concurrency: 'unbounded' }
    )

    const removedIds: string[] = []
    const failedIds: string[] = []

    results.forEach((result, index) => {
      const id = ids[index]
      if (Either.isRight(result)) {
        removedIds.push(id)
      } else {
        failedIds.push(id)
        Effect.logError(result.left)
      }
    })

    return {
      removedIds,
      failedIds
    }
  })
)
