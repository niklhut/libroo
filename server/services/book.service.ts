import { Context, Effect, Layer, Either, Data } from 'effect'
import type { HttpClient } from '@effect/platform'
import { normalizeReadingProgress } from '../../shared/utils/reading-progress'
import { MANUAL_COVER_MAX_BYTES } from '../../shared/utils/schemas'

interface UserBookViewModel {
  id: string
  bookId: string
  book: {
    title: string
    author: string
    authors?: BookAuthor[]
    isbn: string | null
    coverPath: string | null
  }
  tags: string[]
  addedAt: Date
  activeLoan: ActiveLoanSummary | null
}

export class InvalidReadingProgressError extends Data.TaggedError('InvalidReadingProgressError')<{
  message: string
}> { }

export class InvalidManualCoverError extends Data.TaggedError('InvalidManualCoverError')<{
  message: string
}> { }

export const toLibraryBook = (userBook: UserBookViewModel): LibraryBook => ({
  id: userBook.id,
  bookId: userBook.bookId,
  title: userBook.book.title,
  author: userBook.book.author,
  authors: userBook.book.authors,
  isbn: userBook.book.isbn,
  coverPath: userBook.book.coverPath,
  tags: userBook.tags,
  addedAt: userBook.addedAt,
  activeLoan: userBook.activeLoan
})

// ===== Service Interface =====

export interface BookServiceInterface {
  getUserLibrary: (
    userId: string,
    pagination: PaginationParams & { search?: string }
  ) => Effect.Effect<PaginatedResult<LibraryBook>, DatabaseError, DbService>

  getAuthorLibrary: (
    userId: string,
    authorId: string,
    pagination: PaginationParams
  ) => Effect.Effect<AuthorLibrary, BookNotFoundError | DatabaseError, DbService>

  addBookToLibrary: (
    userId: string,
    isbn: string
  ) => Effect.Effect<
    LibraryBook,
    BookCreateError | BookAlreadyOwnedError | OpenLibraryBookNotFoundError | OpenLibraryApiError | DatabaseError,
    DbService | StorageService | OpenLibraryRepository | HttpClient.HttpClient
  >

  createManualBook: (
    userId: string,
    input: ManualBookCreateSchema
  ) => Effect.Effect<
    LibraryBook,
    BookCreateError | InvalidManualCoverError | StorageError | DatabaseError,
    DbService | StorageService
  >

  removeBookFromLibrary: (
    userBookId: string,
    userId: string,
    options?: { confirmActiveLoan?: boolean }
  ) => Effect.Effect<void, BookNotFoundError | ActiveLoanRemovalError | DatabaseError, DbService>

  batchRemoveFromLibrary: (
    ids: string[],
    userId: string
  ) => Effect.Effect<BatchDeleteResult, never, DbService>

  getBookDetails: (
    userBookId: string,
    userId: string
  ) => Effect.Effect<BookDetails, BookNotFoundError | DatabaseError, DbService>

  promoteSuggestedTag: (
    userBookId: string,
    userId: string,
    tagId: string
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>

  addUserTag: (
    userBookId: string,
    userId: string,
    name: string
  ) => Effect.Effect<BookTag, BookNotFoundError | InvalidTagError | DatabaseError, DbService>

  batchUpdateTags: (
    userBookId: string,
    userId: string,
    deleteIds: string[],
    promoteIds: string[],
    createNames: string[]
  ) => Effect.Effect<void, BookNotFoundError | InvalidTagError | DatabaseError, DbService>

  deleteTag: (
    userBookId: string,
    userId: string,
    tagId: string
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>

  lookupBook: (
    userId: string,
    isbn: string
  ) => Effect.Effect<
    BookLookupResult,
    DatabaseError | OpenLibraryApiError,
    DbService | OpenLibraryRepository | HttpClient.HttpClient
  >

  updateRating: (
    userBookId: string,
    userId: string,
    rating: number | null
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>

  updateNote: (
    userBookId: string,
    userId: string,
    note: string | null
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>

  updateReadingProgress: (
    userBookId: string,
    userId: string,
    progress: BookReadingProgressSchema
  ) => Effect.Effect<ReadingProgress, BookNotFoundError | InvalidReadingProgressError | DatabaseError, DbService>
}

// ===== Service Tag =====

export class BookService extends Context.Tag('BookService')<BookService, BookServiceInterface>() { }

// ===== Live Implementation =====

export const BookServiceLive = Layer.effect(
  BookService,
  Effect.gen(function* () {
    const bookRepo = yield* BookRepository

    const normalizeProgress = (
      details: BookDetails,
      input: BookReadingProgressSchema
    ): Effect.Effect<ReadingProgress, InvalidReadingProgressError> =>
      Effect.try({
        try: () => normalizeReadingProgress(details, input),
        catch: error => new InvalidReadingProgressError({
          message: error instanceof Error ? error.message : 'Invalid reading progress'
        })
      })

    const decodeCoverImage = (data: string): Effect.Effect<Buffer, InvalidManualCoverError> =>
      Effect.try({
        try: () => {
          const base64 = data.includes(',') ? data.split(',').at(-1)! : data
          const buffer = Buffer.from(base64, 'base64')
          if (buffer.length === 0) {
            throw new Error('Cover image is empty')
          }
          if (buffer.length > MANUAL_COVER_MAX_BYTES) {
            throw new Error('Cover image is too large')
          }
          return buffer
        },
        catch: error => new InvalidManualCoverError({
          message: error instanceof Error ? error.message : 'Cover image is invalid'
        })
      })

    return {
      getUserLibrary: (userId, pagination) =>
        Effect.gen(function* () {
          const result = yield* bookRepo.getLibrary(userId, pagination)

          return {
            items: result.items.map(toLibraryBook),
            pagination: result.pagination
          }
        }),

      addBookToLibrary: (userId, isbn) =>
        Effect.gen(function* () {
          const userBook = yield* bookRepo.addBookByISBN(userId, isbn)

          return toLibraryBook(userBook)
        }),

      createManualBook: (userId, input) =>
        Effect.gen(function* () {
          let coverPath: string | null = null
          if (input.coverImage) {
            const coverBuffer = yield* decodeCoverImage(input.coverImage.data)
            const pathname = `covers/manual/${userId}/${crypto.randomUUID()}.webp`
            const metadata = yield* putCoverImage(pathname, coverBuffer).pipe(
              Effect.mapError((error) => {
                if (error.operation === 'convertCoverImage') {
                  return new InvalidManualCoverError({ message: 'Cover image is invalid or unsupported' })
                }
                return error
              })
            )
            coverPath = metadata.pathname
          }

          const userBook = yield* bookRepo.createManualBook(userId, {
            title: input.title,
            authors: input.authors,
            isbn: input.isbn,
            coverPath,
            publishDate: input.publishDate,
            publisher: input.publisher,
            numberOfPages: input.numberOfPages,
            rating: input.rating,
            note: input.note,
            readingStatus: input.readingStatus,
            currentPage: input.currentPage,
            progressPercent: input.progressPercent,
            tags: input.tags
          }).pipe(
            Effect.tapError(error =>
              coverPath
                ? deleteBlob(coverPath).pipe(
                    Effect.catchAll(cleanupError =>
                      Effect.logWarning(`Failed to clean up manual cover ${coverPath}: ${cleanupError}`)
                    ),
                    Effect.zipRight(Effect.fail(error))
                  )
                : Effect.fail(error)
            )
          )

          return toLibraryBook(userBook)
        }),

      getAuthorLibrary: (userId, authorId, pagination) =>
        Effect.gen(function* () {
          const result = yield* bookRepo.getLibraryByAuthor(userId, authorId, pagination)

          return {
            author: result.author,
            items: result.items.map(toLibraryBook),
            pagination: result.pagination
          }
        }),

      removeBookFromLibrary: (userBookId, userId, options) =>
        bookRepo.removeFromLibrary(userBookId, userId, options),

      batchRemoveFromLibrary: (ids, userId) =>
        Effect.gen(function* () {
          // Wrap each operation in Either to capture success/failure individually
          const results = yield* Effect.forEach(
            ids,
            id => Effect.either(bookRepo.removeFromLibrary(id, userId)),
            { concurrency: 10 }
          )

          const removedIds: string[] = []
          const failedIds: string[] = []

          const errors: unknown[] = []
          results.forEach((result, index) => {
            const id = ids[index]!
            if (Either.isRight(result)) {
              removedIds.push(id)
            } else {
              failedIds.push(id)
              errors.push(result.left)
            }
          })
          // Log all errors
          for (const error of errors) {
            yield* Effect.logError(error)
          }
          return { removedIds, failedIds }
        }),

      getBookDetails: (userBookId, userId) =>
        bookRepo.getUserBookWithDetails(userBookId, userId),

      lookupBook: (userId, isbn) =>
        Effect.gen(function* () {
          const normalizedISBN = isbn.replace(/[-\s]/g, '')
          const existsInUserLibrary = yield* bookRepo.hasBookInUserLibrary(userId, normalizedISBN)

          // First check if book exists locally
          const localBook = yield* bookRepo.findByIsbn(normalizedISBN)

          if (localBook) {
            const bookTags = yield* bookRepo.getSystemTagsByBookId(localBook.id)

            return {
              found: true,
              isbn: localBook.isbn || normalizedISBN,
              title: localBook.title,
              author: localBook.author,
              authors: localBook.authors.map(author => author.name),
              coverUrl: localBook.coverPath ? `/api/blob/${localBook.coverPath}` : null,
              description: localBook.description ?? undefined,
              subjects: bookTags.map(tag => tag.name),
              publishDate: localBook.publishDate ?? undefined,
              publishers: localBook.publishers ? localBook.publishers.split(', ') : null,
              numberOfPages: localBook.numberOfPages ?? undefined,
              existsLocally: existsInUserLibrary
            } satisfies BookLookupResult
          }

          // Not found locally, try OpenLibrary
          const lookupEffect = lookupByISBN(normalizedISBN).pipe(
            Effect.map((bookData: OpenLibraryBookData): BookLookupResult => ({
              found: true,
              isbn: bookData.isbn,
              title: bookData.title,
              author: bookData.authors.join(', '),
              authors: bookData.authors,
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
                isbn: normalizedISBN,
                message: 'Book not found on OpenLibrary'
              } satisfies BookLookupResult)
            )
          )

          return yield* lookupEffect
        }),

      promoteSuggestedTag: (userBookId, userId, tagId) =>
        bookRepo.promoteSuggestedTag(userBookId, userId, tagId),

      addUserTag: (userBookId, userId, name) =>
        Effect.gen(function* () {
          const tag = yield* bookRepo.addUserTag(userBookId, userId, name)
          return { id: tag.id, name: tag.name }
        }),

      batchUpdateTags: (userBookId, userId, deleteIds, promoteIds, createNames) =>
        bookRepo.batchUpdateTags(userBookId, userId, deleteIds, promoteIds, createNames),

      deleteTag: (userBookId, userId, tagId) =>
        bookRepo.deleteTag(userBookId, userId, tagId),

      updateRating: (userBookId, userId, rating) =>
        bookRepo.updateRating(userBookId, userId, rating),

      updateNote: (userBookId, userId, note) =>
        bookRepo.updateNote(userBookId, userId, note),

      updateReadingProgress: (userBookId, userId, progress) =>
        Effect.gen(function* () {
          const details = yield* bookRepo.getUserBookWithDetails(userBookId, userId)
          const normalized = yield* normalizeProgress(details, progress)
          yield* bookRepo.updateReadingProgress(userBookId, userId, normalized)
          return normalized
        })
    }
  })
)

// ===== Helper Effects =====

export const getUserLibrary = (userId: string, pagination: PaginationParams & { search?: string }) =>
  Effect.flatMap(BookService, service => service.getUserLibrary(userId, pagination))

export const getAuthorLibrary = (userId: string, authorId: string, pagination: PaginationParams) =>
  Effect.flatMap(BookService, service => service.getAuthorLibrary(userId, authorId, pagination))

export const addBookToLibrary = (userId: string, isbn: string) =>
  Effect.flatMap(BookService, service => service.addBookToLibrary(userId, isbn))

export const createManualBook = (userId: string, input: ManualBookCreateSchema) =>
  Effect.flatMap(BookService, service => service.createManualBook(userId, input))

export const removeBookFromLibrary = (
  userBookId: string,
  userId: string,
  options?: { confirmActiveLoan?: boolean }
) =>
  Effect.flatMap(BookService, service => service.removeBookFromLibrary(userBookId, userId, options))

export const batchRemoveFromLibrary = (ids: string[], userId: string) =>
  Effect.flatMap(BookService, service => service.batchRemoveFromLibrary(ids, userId))

export const getBookDetails = (userBookId: string, userId: string) =>
  Effect.flatMap(BookService, service => service.getBookDetails(userBookId, userId))

export const lookupBook = (userId: string, isbn: string) =>
  Effect.flatMap(BookService, service => service.lookupBook(userId, isbn))

export const promoteSuggestedTag = (userBookId: string, userId: string, tagId: string) =>
  Effect.flatMap(BookService, service => service.promoteSuggestedTag(userBookId, userId, tagId))

export const addUserTag = (userBookId: string, userId: string, name: string) =>
  Effect.flatMap(BookService, service => service.addUserTag(userBookId, userId, name))

export const batchUpdateTags = (
  userBookId: string,
  userId: string,
  deleteIds: string[],
  promoteIds: string[],
  createNames: string[]
) =>
  Effect.flatMap(BookService, service => service.batchUpdateTags(userBookId, userId, deleteIds, promoteIds, createNames))

export const deleteTag = (userBookId: string, userId: string, tagId: string) =>
  Effect.flatMap(BookService, service => service.deleteTag(userBookId, userId, tagId))

export const updateRating = (userBookId: string, userId: string, rating: number | null) =>
  Effect.flatMap(BookService, service => service.updateRating(userBookId, userId, rating))

export const updateNote = (userBookId: string, userId: string, note: string | null) =>
  Effect.flatMap(BookService, service => service.updateNote(userBookId, userId, note))

export const updateReadingProgress = (
  userBookId: string,
  userId: string,
  progress: BookReadingProgressSchema
) =>
  Effect.flatMap(BookService, service => service.updateReadingProgress(userBookId, userId, progress))
