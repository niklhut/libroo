import { books } from 'hub:db:schema'
import { eq, and } from 'drizzle-orm'
import { blob } from 'hub:blob'

export default defineEventHandler(async (event) => {
  // Validate session
  const session = await auth.api.getSession({
    headers: event.headers
  })

  if (!session) {
    throw createError({
      statusCode: 401,
      message: 'Unauthorized'
    })
  }

  // Get book ID from route params
  const bookId = getRouterParam(event, 'id')

  if (!bookId) {
    throw createError({
      statusCode: 400,
      message: 'Book ID is required'
    })
  }

  const db = useDrizzle()

  // Find the book to delete (and verify ownership)
  const existingBooks = await db
    .select()
    .from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, session.user.id)))
    .limit(1)

  if (existingBooks.length === 0) {
    throw createError({
      statusCode: 404,
      message: 'Book not found'
    })
  }

  const book = existingBooks[0]

  if (!book) {
    throw createError({
      statusCode: 404,
      message: 'Book not found'
    })
  }

  // Delete cover image if it exists
  if (book.coverPath) {
    try {
      await blob.delete(book.coverPath)
    } catch (error) {
      // Ignore blob deletion errors
      console.warn('Failed to delete cover image:', error)
    }
  }

  // Delete the book
  await db.delete(books).where(eq(books.id, bookId))

  return { success: true }
})
