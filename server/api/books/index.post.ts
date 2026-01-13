import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, bookIsbnSchema.parse),
      catch: (e) => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })

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
