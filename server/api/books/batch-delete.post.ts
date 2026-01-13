import { Effect, Either } from 'effect'
import { effectHandler } from '../../utils/effectHandler'
import { removeFromLibrary } from '../../repositories/book.repository'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise(() => readBody<{ ids: string[] }>(event))
    const { ids } = body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return { removedIds: [], failedIds: [] }
    }

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
