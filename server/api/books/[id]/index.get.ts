import { Effect } from 'effect'
import { effectHandler } from '../../../utils/effectHandler'
import { DbService } from '../../../services/db.service'
import { eq, and } from 'drizzle-orm'
import { books, userBooks } from 'hub:db:schema'

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

    // Get userBook with book details (verify ownership)
    const dbService = yield* DbService
    const result = yield* Effect.tryPromise({
      try: () =>
        dbService.db
          .select()
          .from(userBooks)
          .innerJoin(books, eq(userBooks.bookId, books.id))
          .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, user.id)))
          .limit(1),
      catch: (error) => new Error(`Database error: ${error}`)
    })

    const row = result[0]
    if (!row) {
      return yield* Effect.fail(
        createError({
          statusCode: 404,
          message: 'Book not found'
        })
      )
    }

    // Cast to any to access new schema fields that may not be in stale types
    const bookData = row.books as any

    return {
      id: row.user_books.id,
      bookId: bookData.id,
      title: bookData.title,
      author: bookData.author,
      isbn: bookData.isbn,
      coverPath: bookData.coverPath ?? bookData.cover_path,
      description: bookData.description ?? null,
      subjects: bookData.subjects ? JSON.parse(bookData.subjects) : null,
      publishDate: bookData.publishDate ?? bookData.publish_date ?? null,
      publishers: bookData.publishers ?? null,
      numberOfPages: bookData.numberOfPages ?? bookData.number_of_pages ?? null,
      openLibraryKey: bookData.openLibraryKey ?? bookData.open_library_key,
      addedAt: row.user_books.addedAt
    }
  })
)
