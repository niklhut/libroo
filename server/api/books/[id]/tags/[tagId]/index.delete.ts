import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const userBookId = getRouterParam(event, 'id')
    const tagId = getRouterParam(event, 'tagId')

    if (!userBookId || !tagId) {
      return yield* Effect.fail(
        createError({
          statusCode: 400,
          message: 'Book ID and Tag ID are required'
        })
      )
    }

    yield* deleteTag(userBookId, user.id, tagId)

    return { success: true }
  })
)
