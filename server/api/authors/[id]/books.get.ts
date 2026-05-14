import { Effect } from 'effect'

const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 100

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const authorId = getRouterParam(event, 'id')

    if (!authorId) {
      return yield* Effect.fail(
        createError({
          statusCode: 400,
          message: 'Author ID is required'
        })
      )
    }

    const query = getQuery(event)
    const page = Math.max(1, parseInt(query.page as string) || 1)
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(query.pageSize as string) || DEFAULT_PAGE_SIZE)
    )

    return yield* getAuthorLibrary(user.id, authorId, { page, pageSize })
  })
)
