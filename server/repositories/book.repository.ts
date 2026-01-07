import { Context, Effect, Layer, Data } from 'effect'
import { eq, and, count, desc } from 'drizzle-orm'
import { DbService } from '../services/db.service'
import { StorageService } from '../services/storage.service'
import {
  OpenLibraryRepository,
  downloadCover,
  lookupByISBN,
  BookNotFoundError as OpenLibraryNotFoundError,
  OpenLibraryApiError
} from './openLibrary.repository'
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

// Output types
export interface Book {
  id: string
  isbn: string | null
  title: string
  author: string
  coverPath: string | null
  openLibraryKey: string | null
  createdAt: Date
}

export interface UserBook {
  id: string
  bookId: string
  book: Book
  addedAt: Date
}

// Pagination types
export interface PaginationParams {
  page: number
  pageSize: number
}

export interface PaginatedResult<T> {
  items: T[]
  pagination: {
    page: number
    pageSize: number
    totalItems: number
    totalPages: number
    hasMore: boolean
  }
}

// Service interface
export interface BookRepositoryInterface {
  addBookByISBN: (
    userId: string,
    isbn: string
  ) => Effect.Effect<
    UserBook,
    BookCreateError | BookAlreadyOwnedError | OpenLibraryNotFoundError | OpenLibraryApiError | Error,
    DbService | StorageService | OpenLibraryRepository
  >

  getLibrary: (
    userId: string,
    pagination: PaginationParams
  ) => Effect.Effect<PaginatedResult<UserBook>, Error, DbService>

  getBookById: (bookId: string) => Effect.Effect<Book, BookNotFoundError | Error, DbService>

  removeFromLibrary: (
    userBookId: string,
    userId: string
  ) => Effect.Effect<void, BookNotFoundError | Error, DbService>
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
          const existingUserBook = yield* Effect.tryPromise({
            try: async () => {
              const result = await dbService.db
                .select()
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .where(and(eq(userBooks.userId, userId), eq(books.isbn, isbn)))
                .limit(1)
              return result[0] || null
            },
            catch: (error) => new BookCreateError({ message: `Database error: ${error}` })
          })

          if (existingUserBook) {
            return yield* Effect.fail(new BookAlreadyOwnedError({ isbn }))
          }

          // Check if book already exists in database (shared)
          let book = yield* Effect.tryPromise({
            try: async () => {
              const result = await dbService.db
                .select()
                .from(books)
                .where(eq(books.isbn, isbn))
                .limit(1)
              return result[0] || null
            },
            catch: (error) => new BookCreateError({ message: `Database error: ${error}` })
          })

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
              catch: (error) => new BookCreateError({ message: `Failed to insert book: ${error}` })
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
                bookId: book!.id,
                addedAt
              }),
            catch: (error) => new BookCreateError({ message: `Failed to add book to library: ${error}` })
          })

          return {
            id: userBookId,
            bookId: book!.id,
            book: {
              id: book!.id,
              isbn: book!.isbn,
              title: book!.title,
              author: book!.author,
              coverPath: book!.coverPath,
              openLibraryKey: book!.openLibraryKey,
              createdAt: book!.createdAt instanceof Date ? book!.createdAt : new Date(book!.createdAt as unknown as string)
            },
            addedAt
          }
        }),

      getLibrary: (userId, pagination) =>
        Effect.tryPromise({
          try: async () => {
            const { page, pageSize } = pagination
            const offset = (page - 1) * pageSize

            // Get total count
            const countResult = await dbService.db
              .select({ count: count() })
              .from(userBooks)
              .where(eq(userBooks.userId, userId))

            const totalItems = countResult[0]?.count ?? 0
            const totalPages = Math.ceil(totalItems / pageSize)

            // Get paginated items
            const result = await dbService.db
              .select()
              .from(userBooks)
              .innerJoin(books, eq(userBooks.bookId, books.id))
              .where(eq(userBooks.userId, userId))
              .orderBy(desc(userBooks.addedAt))
              .limit(pageSize)
              .offset(offset)

            const items = result.map((row) => ({
              id: row.user_books.id,
              bookId: row.books.id,
              book: {
                id: row.books.id,
                isbn: row.books.isbn,
                title: row.books.title,
                author: row.books.author,
                coverPath: row.books.coverPath,
                openLibraryKey: row.books.openLibraryKey,
                createdAt: row.books.createdAt instanceof Date
                  ? row.books.createdAt
                  : new Date(row.books.createdAt as unknown as string)
              },
              addedAt: row.user_books.addedAt instanceof Date
                ? row.user_books.addedAt
                : new Date(row.user_books.addedAt as unknown as string)
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
          },
          catch: (error) => new Error(`Failed to get library: ${error}`)
        }),

      getBookById: (bookId) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select()
                .from(books)
                .where(eq(books.id, bookId))
                .limit(1),
            catch: (error) => new Error(`Database error: ${error}`)
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
            catch: (error) => new Error(`Database error: ${error}`)
          })

          if (result.length === 0) {
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }
        })
    }
  })
)

// Helper effects
export const addBookByISBN = (userId: string, isbn: string) =>
  Effect.flatMap(BookRepository, (repo) => repo.addBookByISBN(userId, isbn))

export const getLibrary = (userId: string, pagination: PaginationParams) =>
  Effect.flatMap(BookRepository, (repo) => repo.getLibrary(userId, pagination))

export const getBookById = (bookId: string) =>
  Effect.flatMap(BookRepository, (repo) => repo.getBookById(bookId))

export const removeFromLibrary = (userBookId: string, userId: string) =>
  Effect.flatMap(BookRepository, (repo) => repo.removeFromLibrary(userBookId, userId))
