import { Effect, Layer } from 'effect'
import { books } from 'hub:db:schema'
import { eq } from 'drizzle-orm'

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

  const db = useDrizzle()

  // Get all books for the user
  const userBooks = await db
    .select()
    .from(books)
    .where(eq(books.userId, session.user.id))
    .orderBy(books.createdAt)

  return userBooks.map((book) => ({
    id: book.id,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    coverPath: book.coverPath,
    createdAt: book.createdAt
  }))
})
