import { Effect } from 'effect'

// Default pagination values
const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 100

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    // Parse query parameters
    const query = getQuery(event)
    const page = Math.max(1, parseInt(query.page as string) || 1)
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(query.pageSize as string) || DEFAULT_PAGE_SIZE)
    )

    // Get user's library with SQL pagination
    const result = yield* getLibrary(user.id, { page, pageSize })

    return {
      items: result.items.map((userBook: UserBook) => ({
        id: userBook.id,
        bookId: userBook.bookId,
        title: userBook.book.title,
        author: userBook.book.author,
        isbn: userBook.book.isbn,
        coverPath: userBook.book.coverPath,
        addedAt: userBook.addedAt
      })),
      pagination: result.pagination
    }
  })
)
