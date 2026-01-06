import { runEffect, Effect } from '../../utils/effect'
import { addBookByISBN, BookAlreadyOwnedError } from '../../repositories/book.repository'
import { BookNotFoundError, OpenLibraryApiError } from '../../repositories/openLibrary.repository'
import { requireAuth } from '../../services/auth.service'

export default defineEventHandler(async (event) => {
  // Read request body
  const body = await readBody(event)

  if (!body?.isbn) {
    throw createError({
      statusCode: 400,
      message: 'ISBN is required'
    })
  }

  try {
    return await runEffect(
      Effect.gen(function* () {
        // Get authenticated user
        const user = yield* requireAuth(event)

        // Add book by ISBN (will lookup from OpenLibrary if not exists)
        const userBook = yield* addBookByISBN(user.id, body.isbn)

        return {
          id: userBook.id,
          bookId: userBook.bookId,
          title: userBook.book.title,
          author: userBook.book.author,
          isbn: userBook.book.isbn,
          coverPath: userBook.book.coverPath,
          addedAt: userBook.addedAt
        }
      }),
      event
    )
  } catch (error: any) {
    // Handle specific errors
    if (error._tag === 'BookAlreadyOwnedError') {
      throw createError({
        statusCode: 409,
        message: `You already have this book (ISBN: ${error.isbn}) in your library`
      })
    }
    if (error._tag === 'BookNotFoundError') {
      throw createError({
        statusCode: 404,
        message: `Book with ISBN ${error.isbn} not found on OpenLibrary`
      })
    }
    if (error._tag === 'OpenLibraryApiError') {
      throw createError({
        statusCode: 502,
        message: `Failed to lookup book: ${error.message}`
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
