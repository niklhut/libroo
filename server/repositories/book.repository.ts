import { Context, Effect, Layer, Data } from 'effect'
import type { HttpClient } from '@effect/platform'
import { eq, and, count, desc } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'
import { books, userBooks } from 'hub:db:schema'

// Error types
export class BookNotFoundError extends Data.TaggedError('BookNotFoundError')<{
  bookId?: string
  isbn?: string
}> { }

export class BookCreateError extends Data.TaggedError('BookCreateError')<{
  message: string
}> { }

export class BookAlreadyOwnedError extends Data.TaggedError('BookAlreadyOwnedError')<{
  isbn: string
}> { }

export class DatabaseError extends Data.TaggedError('DatabaseError')<{
  message: string
  operation: string
}> { }

// Output types
export interface Book {
  id: string
  isbn: string | null
  title: string
  author: string
  coverPath: string | null
  openLibraryKey: string | null
  createdAt: Date
  description?: string | null
  subjects?: string | null
  publishDate?: string | null
  publishers?: string | null
  numberOfPages?: number | null
  workKey?: string | null
}

export interface UserBook {
  id: string
  bookId: string
  book: Book
  addedAt: Date
}

// Service interface
export interface BookRepositoryInterface {
  addBookByISBN: (
    userId: string,
    isbn: string
  ) => Effect.Effect<
    UserBook,
    BookCreateError | BookAlreadyOwnedError | OpenLibraryBookNotFoundError | OpenLibraryApiError | DatabaseError,
    DbService | StorageService | OpenLibraryRepository | HttpClient.HttpClient
  >

  getLibrary: (
    userId: string,
    pagination: PaginationParams
  ) => Effect.Effect<PaginatedResult<UserBook>, DatabaseError, DbService>

  getBookById: (bookId: string) => Effect.Effect<Book, BookNotFoundError | DatabaseError, DbService>

  removeFromLibrary: (
    userBookId: string,
    userId: string
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>

  findByIsbn: (
    isbn: string
  ) => Effect.Effect<InferSelectModel<typeof books> | null, DatabaseError, DbService>

  getUserBookWithDetails: (
    userBookId: string,
    userId: string
  ) => Effect.Effect<BookDetails, BookNotFoundError | DatabaseError, DbService>
}

// Service tag
export class BookRepository extends Context.Tag('BookRepository')<BookRepository, BookRepositoryInterface>() { }

// Generate unique ID
function generateId(): string {
  return crypto.randomUUID()
}

// Live implementation
export const BookRepositoryLive = Layer.effect(
  BookRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      addBookByISBN: (userId, isbn) =>
        Effect.gen(function* () {
          // Check if user already owns a book with this ISBN
          const existingResult = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select()
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .where(and(eq(userBooks.userId, userId), eq(books.isbn, isbn)))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to check existing ownership: ${error}`,
              operation: 'addBookByISBN.checkExisting'
            })
          })

          if (existingResult[0]) {
            return yield* Effect.fail(new BookAlreadyOwnedError({ isbn }))
          }

          // Check if book already exists in database (shared)
          const bookResult = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select()
                .from(books)
                .where(eq(books.isbn, isbn))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to find existing book: ${error}`,
              operation: 'addBookByISBN.findExisting'
            })
          })

          let book = bookResult[0] || null

          // If book doesn't exist, fetch from OpenLibrary and create it
          if (!book) {
            const openLibraryData = yield* lookupByISBN(isbn)

            // Download cover to local storage
            const coverPath = yield* downloadCover(isbn, 'L')

            const newBookId = generateId()
            const now = new Date()

            const newBook = {
              id: newBookId,
              isbn: openLibraryData.isbn,
              title: openLibraryData.title,
              author: openLibraryData.authors.join(', '),
              coverPath,
              openLibraryKey: openLibraryData.openLibraryKey,
              workKey: openLibraryData.workKey || null,
              description: openLibraryData.description || null,
              subjects: openLibraryData.subjects ? JSON.stringify(openLibraryData.subjects) : null,
              publishDate: openLibraryData.publishDate || null,
              publishers: openLibraryData.publishers?.join(', ') || null,
              numberOfPages: openLibraryData.numberOfPages || null,
              createdAt: now
            }

            yield* Effect.tryPromise({
              try: () => dbService.db.insert(books).values(newBook),
              catch: error => new BookCreateError({ message: `Failed to insert book: ${error}` })
            })

            book = newBook
          }

          // Create userBooks entry
          const userBookId = generateId()
          const addedAt = new Date()

          yield* Effect.tryPromise({
            try: () =>
              dbService.db.insert(userBooks).values({
                id: userBookId,
                userId,
                bookId: book.id,
                addedAt
              }),
            catch: error => new BookCreateError({ message: `Failed to add book to library: ${error}` })
          })

          return {
            id: userBookId,
            bookId: book.id,
            book: {
              id: book.id,
              isbn: book.isbn,
              title: book.title,
              author: book.author,
              coverPath: book.coverPath,
              openLibraryKey: book.openLibraryKey,
              createdAt: book.createdAt
            },
            addedAt
          }
        }),

      getLibrary: (userId, pagination) =>
        Effect.gen(function* () {
          const { page, pageSize } = pagination
          const offset = (page - 1) * pageSize

          // Get total count
          const countResult = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select({ count: count() })
                .from(userBooks)
                .where(eq(userBooks.userId, userId)),
            catch: error => new DatabaseError({
              message: `Failed to count library items: ${error}`,
              operation: 'getLibrary.count'
            })
          })

          const totalItems = countResult[0]?.count ?? 0
          const totalPages = Math.ceil(totalItems / pageSize)

          // Get paginated items
          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select()
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .where(eq(userBooks.userId, userId))
                .orderBy(desc(userBooks.addedAt))
                .limit(pageSize)
                .offset(offset),
            catch: error => new DatabaseError({
              message: `Failed to get library items: ${error}`,
              operation: 'getLibrary.items'
            })
          })

          const items = result.map(row => ({
            id: row.user_books.id,
            bookId: row.books.id,
            book: {
              id: row.books.id,
              isbn: row.books.isbn,
              title: row.books.title,
              author: row.books.author,
              coverPath: row.books.coverPath,
              openLibraryKey: row.books.openLibraryKey,
              createdAt: row.books.createdAt
            },
            addedAt: row.user_books.addedAt
          }))

          return {
            items,
            pagination: {
              page,
              pageSize,
              totalItems,
              totalPages,
              hasMore: page < totalPages
            }
          }
        }),

      getBookById: bookId =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select()
                .from(books)
                .where(eq(books.id, bookId))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to get book: ${error}`,
              operation: 'getBookById'
            })
          })

          const [book] = result
          if (!book) {
            return yield* Effect.fail(new BookNotFoundError({ bookId }))
          }

          return {
            id: book.id,
            isbn: book.isbn,
            title: book.title,
            author: book.author,
            coverPath: book.coverPath,
            openLibraryKey: book.openLibraryKey,
            createdAt: book.createdAt instanceof Date ? book.createdAt : new Date(book.createdAt as unknown as string)
          }
        }),

      removeFromLibrary: (userBookId, userId) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .delete(userBooks)
                .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId)))
                .returning(),
            catch: error => new DatabaseError({
              message: `Failed to remove book from library: ${error}`,
              operation: 'removeFromLibrary'
            })
          })

          if (result.length === 0) {
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }
        }),

      findByIsbn: isbn =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select()
                .from(books)
                .where(eq(books.isbn, isbn))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to find book by ISBN: ${error}`,
              operation: 'findByIsbn'
            })
          })
          return result[0] || null
        }),

      getUserBookWithDetails: (userBookId, userId) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select()
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId)))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to get book details: ${error}`,
              operation: 'getUserBookWithDetails'
            })
          })

          const row = result[0]
          if (!row) {
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }

          const bookData = row.books

          return {
            id: row.user_books.id,
            bookId: bookData.id,
            title: bookData.title,
            author: bookData.author,
            isbn: bookData.isbn,
            coverPath: bookData.coverPath,
            description: bookData.description ?? null,
            subjects: bookData.subjects ? JSON.parse(bookData.subjects) : null,
            publishDate: bookData.publishDate ?? null,
            publishers: bookData.publishers ?? null,
            numberOfPages: bookData.numberOfPages ?? null,
            openLibraryKey: bookData.openLibraryKey,
            workKey: bookData.workKey ?? null,
            addedAt: row.user_books.addedAt
          }
        })
    }
  })
)

// Helper effects
export const addBookByISBN = (userId: string, isbn: string) =>
  Effect.flatMap(BookRepository, repo => repo.addBookByISBN(userId, isbn))

export const getLibrary = (userId: string, pagination: PaginationParams) =>
  Effect.flatMap(BookRepository, repo => repo.getLibrary(userId, pagination))

export const getBookById = (bookId: string) =>
  Effect.flatMap(BookRepository, repo => repo.getBookById(bookId))

export const removeFromLibrary = (userBookId: string, userId: string) =>
  Effect.flatMap(BookRepository, repo => repo.removeFromLibrary(userBookId, userId))
