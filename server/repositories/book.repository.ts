import { Context, Effect, Layer, Data } from 'effect'
import { eq } from 'drizzle-orm'
import { DbService } from '../services/db.service'
import { StorageService, putBlob } from '../services/storage.service'
import { books } from 'hub:db:schema'

// Error types
export class BookNotFoundError extends Data.TaggedError('BookNotFoundError')<{
  bookId: string
}> { }

export class BookCreateError extends Data.TaggedError('BookCreateError')<{
  message: string
}> { }

// Input types
export interface AddBookInput {
  title: string
  author: string
  isbn?: string
  coverImage?: {
    data: Buffer | Blob | ArrayBuffer
    contentType: string
    filename: string
  }
}

// Output types
export interface Book {
  id: string
  title: string
  author: string
  isbn: string | null
  coverPath: string | null
  userId: string
  createdAt: Date
}

// Service interface
export interface BookRepositoryInterface {
  addBook: (userId: string, input: AddBookInput) => Effect.Effect<Book, BookCreateError | Error, StorageService | DbService>
  getLibrary: (userId: string) => Effect.Effect<Book[], Error, DbService>
  getBookById: (bookId: string) => Effect.Effect<Book, BookNotFoundError | Error, DbService>
  deleteBook: (bookId: string, userId: string) => Effect.Effect<void, BookNotFoundError | Error, DbService>
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
      addBook: (userId, input) =>
        Effect.gen(function* () {
          let coverPath: string | null = null

          // Upload cover image if provided
          if (input.coverImage) {
            const blobResult = yield* putBlob(
              `covers/${userId}/${generateId()}-${input.coverImage.filename}`,
              input.coverImage.data,
              { contentType: input.coverImage.contentType }
            )
            coverPath = blobResult.pathname
          }

          const id = generateId()
          const now = new Date()

          const newBook = {
            id,
            title: input.title,
            author: input.author,
            isbn: input.isbn ?? null,
            coverPath,
            userId,
            createdAt: now
          }

          const result = yield* Effect.tryPromise({
            try: () => dbService.db.insert(books).values(newBook),
            catch: (error) => new BookCreateError({ message: `Failed to create book: ${error}` })
          })

          return newBook
        }),

      getLibrary: (userId) =>
        Effect.tryPromise({
          try: async () => {
            const result = await dbService.db
              .select()
              .from(books)
              .where(eq(books.userId, userId))
              .orderBy(books.createdAt)

            return result.map((book) => ({
              ...book,
              createdAt: new Date(book.createdAt)
            }))
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
            catch: (error) => new Error(`Failed to get book: ${error}`)
          })

          if (result.length === 0) {
            return yield* Effect.fail(new BookNotFoundError({ bookId }))
          }

          return {
            ...result[0],
            createdAt: new Date(result[0].createdAt)
          }
        }),

      deleteBook: (bookId, userId) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .delete(books)
                .where(eq(books.id, bookId))
                .returning(),
            catch: (error) => new Error(`Failed to delete book: ${error}`)
          })

          if (result.length === 0 || result[0].userId !== userId) {
            return yield* Effect.fail(new BookNotFoundError({ bookId }))
          }
        })
    }
  })
)

// Helper effects
export const addBook = (userId: string, input: AddBookInput) =>
  Effect.flatMap(BookRepository, (repo) => repo.addBook(userId, input))

export const getLibrary = (userId: string) =>
  Effect.flatMap(BookRepository, (repo) => repo.getLibrary(userId))

export const getBookById = (bookId: string) =>
  Effect.flatMap(BookRepository, (repo) => repo.getBookById(bookId))

export const deleteBook = (bookId: string, userId: string) =>
  Effect.flatMap(BookRepository, (repo) => repo.deleteBook(bookId, userId))
