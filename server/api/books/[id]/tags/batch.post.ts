import { Effect } from 'effect'
import { z } from 'zod'

const batchTagUpdateSchema = z.object({
  deleteIds: z.array(z.string({ error: 'Tag ID must be a string' })).default([]),
  promoteIds: z.array(z.string({ error: 'Tag ID must be a string' })).default([]),
  createNames: z.array(z.string({ error: 'Tag name must be a string' })).default([])
})

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const userBookId = getRouterParam(event, 'id')

    if (!userBookId) {
      return yield* Effect.fail(
        createError({
          statusCode: 400,
          message: 'Book ID is required'
        })
      )
    }

    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, batchTagUpdateSchema.parse),
      catch: () => createError({ statusCode: 400, message: 'Validation Error' })
    })

    yield* batchUpdateTags(userBookId, user.id, body.deleteIds, body.promoteIds, body.createNames)

    return { success: true }
  })
)