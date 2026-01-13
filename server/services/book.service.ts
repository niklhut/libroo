import { Context, Effect, Layer, Either } from 'effect'

// ===== Service Interface =====

export interface BookServiceInterface {
  getUserLibrary: (
    userId: string,
    pagination: PaginationParams
  ) => Effect.Effect<PaginatedResult<LibraryBook>, Error, DbService>

  addBookToLibrary: (
    userId: string,
    isbn: string
  ) => Effect.Effect<
    LibraryBook,
    Error,
    DbService | StorageService | OpenLibraryRepository
  >

  removeBookFromLibrary: (
    userBookId: string,
    userId: string
  ) => Effect.Effect<void, BookNotFoundError | Error, DbService>

  batchRemoveFromLibrary: (
    ids: string[],
    userId: string
  ) => Effect.Effect<BatchDeleteResult, never, DbService>

  getBookDetails: (
    userBookId: string,
    userId: string
  ) => Effect.Effect<BookDetails, BookNotFoundError | Error, DbService>

  lookupBook: (
    isbn: string
  ) => Effect.Effect<
    BookLookupResult,
    Error,
    DbService | OpenLibraryRepository
  >
}

// ===== Service Tag =====

export class BookService extends Context.Tag('BookService')<BookService, BookServiceInterface>() { }

// ===== Live Implementation =====

export const BookServiceLive = Layer.effect(
  BookService,
  Effect.gen(function* () {
    const bookRepo = yield* BookRepository

    return {
      getUserLibrary: (userId, pagination) =>
        Effect.gen(function* () {
          const result = yield* bookRepo.getLibrary(userId, pagination)

          return {
            items: result.items.map((userBook): LibraryBook => ({
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
        }),

      addBookToLibrary: (userId, isbn) =>
        Effect.gen(function* () {
          const userBook = yield* bookRepo.addBookByISBN(userId, isbn)

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

      removeBookFromLibrary: (userBookId, userId) =>
        bookRepo.removeFromLibrary(userBookId, userId),

      batchRemoveFromLibrary: (ids, userId) =>
        Effect.gen(function* () {
          // Process all deletions in parallel (unbounded concurrency)
          // Wrap each operation in Either to capture success/failure individually
          const results = yield* Effect.forEach(
            ids,
            id => Effect.either(bookRepo.removeFromLibrary(id, userId)),
            { concurrency: 'unbounded' }
          )

          const removedIds: string[] = []
          const failedIds: string[] = []

          results.forEach((result, index) => {
            const id = ids[index]!
            if (Either.isRight(result)) {
              removedIds.push(id)
            } else {
              failedIds.push(id)
              // Log the error for debugging
              Effect.logError(result.left)
            }
          })

          return { removedIds, failedIds }
        }),

      getBookDetails: (userBookId, userId) =>
        Effect.gen(function* () {
          const result = yield* bookRepo.getUserBookWithDetails(userBookId, userId)
          return result
        }),

      lookupBook: isbn =>
        Effect.gen(function* () {
          const normalizedISBN = isbn.replace(/[-\s]/g, '')

          // First check if book exists locally
          const localBook = yield* bookRepo.findByIsbn(normalizedISBN)

          if (localBook) {
            return {
              found: true,
              isbn: localBook.isbn || normalizedISBN,
              title: localBook.title,
              author: localBook.author,
              coverUrl: localBook.coverPath ? `/api/blob/${localBook.coverPath}` : null,
              description: localBook.description ?? undefined,
              subjects: localBook.subjects ? JSON.parse(localBook.subjects) : null,
              publishDate: localBook.publishDate ?? undefined,
              publishers: localBook.publishers ? localBook.publishers.split(', ') : null,
              numberOfPages: localBook.numberOfPages ?? undefined,
              existsLocally: true
            } satisfies BookLookupResult
          }

          // Not found locally, try OpenLibrary
          const lookupEffect = lookupByISBN(isbn).pipe(
            Effect.map((bookData: OpenLibraryBookData): BookLookupResult => ({
              found: true,
              isbn: bookData.isbn,
              title: bookData.title,
              author: bookData.authors.join(', '),
              coverUrl: bookData.coverUrl,
              description: bookData.description,
              subjects: bookData.subjects ?? null,
              publishDate: bookData.publishDate,
              publishers: bookData.publishers ?? null,
              numberOfPages: bookData.numberOfPages,
              existsLocally: false
            })),
            Effect.catchTag('OpenLibraryBookNotFoundError', () =>
              Effect.succeed({
                found: false,
                isbn,
                message: 'Book not found on OpenLibrary'
              } satisfies BookLookupResult)
            )
          )

          return yield* lookupEffect
        })
    }
  })
)

// ===== Helper Effects =====

export const getUserLibrary = (userId: string, pagination: PaginationParams) =>
  Effect.flatMap(BookService, service => service.getUserLibrary(userId, pagination))

export const addBookToLibrary = (userId: string, isbn: string) =>
  Effect.flatMap(BookService, service => service.addBookToLibrary(userId, isbn))

export const removeBookFromLibrary = (userBookId: string, userId: string) =>
  Effect.flatMap(BookService, service => service.removeBookFromLibrary(userBookId, userId))

export const batchRemoveFromLibrary = (ids: string[], userId: string) =>
  Effect.flatMap(BookService, service => service.batchRemoveFromLibrary(ids, userId))

export const getBookDetails = (userBookId: string, userId: string) =>
  Effect.flatMap(BookService, service => service.getBookDetails(userBookId, userId))

export const lookupBook = (isbn: string) =>
  Effect.flatMap(BookService, service => service.lookupBook(isbn))
