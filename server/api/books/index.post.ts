import { Effect } from 'effect'
import { effectHandler } from '../../utils/effectHandler'
import { addBookByISBN } from '../../repositories/book.repository'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    // Read request body
    const body = yield* Effect.tryPromise({
      try: () => readBody(event),
      catch: () => new Error('Invalid request body')
    })

    // Validate ISBN
    if (!body?.isbn || typeof body.isbn !== 'string') {
      return yield* Effect.fail(
        createError({
          statusCode: 400,
          message: 'ISBN is required'
        })
      )
    }

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
  })
)
