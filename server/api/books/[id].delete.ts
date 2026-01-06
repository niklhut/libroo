import { runEffect, Effect } from '../../utils/effect'
import { removeFromLibrary } from '../../repositories/book.repository'
import { requireAuth } from '../../services/auth.service'

export default defineEventHandler(async (event) => {
  // Get userBook ID from route params
  const userBookId = getRouterParam(event, 'id')

  if (!userBookId) {
    throw createError({
      statusCode: 400,
      message: 'Book ID is required'
    })
  }

  try {
    await runEffect(
      Effect.gen(function* () {
        // Get authenticated user
        const user = yield* requireAuth(event)

        // Remove book from user's library
        yield* removeFromLibrary(userBookId, user.id)
      }),
      event
    )

    return { success: true }
  } catch (error: any) {
    if (error._tag === 'BookNotFoundError') {
      throw createError({
        statusCode: 404,
        message: 'Book not found in your library'
      })
    }
    if (error._tag === 'UnauthorizedError') {
      throw createError({
        statusCode: 401,
        message: 'Unauthorized'
      })
    }
    throw error
  }
})
