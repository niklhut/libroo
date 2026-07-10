import { Context, Effect, Layer, Either, Data } from 'effect'
import type * as HttpClient from '@effect/platform/HttpClient'
import { normalizeReadingProgress } from '../../shared/utils/reading-progress'
import { MANUAL_COVER_MAX_BYTES } from '../../shared/utils/schemas'
import type { LibraryQueryFilters } from '../../shared/utils/library-query'
import type { LibraryState } from '../../shared/types/book'

interface UserBookViewModel {
  id: string
  bookId: string
  libraryState: LibraryState
  book: {
    title: string
    author: string
    authors?: BookAuthor[]
    isbn: string | null
    coverPath: string | null
  }
  location: BookLocation | null
  lastKnownLocation: string | null
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

export interface RepairOpenLibraryCoversResult {
  attempted: number
  repaired: number
  skipped: number
  failed: number
}

export interface BulkAddBookInput {
  isbn: string
  libraryState?: LibraryState
}

export interface BulkAddBooksResult {
  added: Array<{ isbn: string }>
  failed: Array<{ isbn: string, error: string }>
}

export const toLibraryBook = (userBook: UserBookViewModel): LibraryBook => ({
  id: userBook.id,
  bookId: userBook.bookId,
  libraryState: userBook.libraryState,
  title: userBook.book.title,
  author: userBook.book.author,
  authors: userBook.book.authors,
  isbn: userBook.book.isbn,
  coverPath: userBook.book.coverPath,
  tags: userBook.tags,
  location: userBook.location,
  lastKnownLocation: userBook.lastKnownLocation,
  addedAt: userBook.addedAt,
  activeLoan: userBook.activeLoan
})

// ===== Service Interface =====

export interface BookServiceInterface {
  getUserLibrary: (
    userId: string,
    pagination: PaginationParams & LibraryQueryFilters
  ) => Effect.Effect<PaginatedResult<LibraryBook>, LocationNotFoundError | DatabaseError, DbService>

  getAuthorLibrary: (
    userId: string,
    authorId: string,
    pagination: PaginationParams
  ) => Effect.Effect<AuthorLibrary, BookNotFoundError | DatabaseError, DbService>

  addBookToLibrary: (
    userId: string,
    isbn: string,
    libraryState?: LibraryState
  ) => Effect.Effect<
    LibraryBook,
    BookCreateError | BookAlreadyOwnedError | OpenLibraryBookNotFoundError | OpenLibraryApiError | DatabaseError,
    DbService | StorageService | OpenLibraryRepository | HttpClient.HttpClient
  >

  bulkAddBooks: (
    userId: string,
    books: BulkAddBookInput[]
  ) => Effect.Effect<
    BulkAddBooksResult,
    never,
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

  repairMissingOpenLibraryCovers: (
    limit?: number
  ) => Effect.Effect<
    RepairOpenLibraryCoversResult,
    DatabaseError,
    DbService | StorageService | OpenLibraryRepository | HttpClient.HttpClient
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
    BookCreateError | DatabaseError | OpenLibraryApiError,
    DbService | StorageService | OpenLibraryRepository | HttpClient.HttpClient
  >

  updateRating: (
    userBookId: string,
    userId: string,
    rating: number | null
  ) => Effect.Effect<void, BookNotFoundError | BookNotOwnedError | DatabaseError, DbService>

  updateNote: (
    userBookId: string,
    userId: string,
    note: string | null
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>

  updateLocation: (
    userBookId: string,
    userId: string,
    locationId: string | null
  ) => Effect.Effect<BookLocation | null, BookNotFoundError | BookNotOwnedError | LocationNotFoundError | DatabaseError, DbService>

  updateReadingProgress: (
    userBookId: string,
    userId: string,
    progress: BookReadingProgressSchema
  ) => Effect.Effect<ReadingProgress, BookNotFoundError | BookNotOwnedError | InvalidReadingProgressError | DatabaseError, DbService>

  updateLibraryState: (
    userBookId: string,
    userId: string,
    state: LibraryState
  ) => Effect.Effect<LibraryBook, BookNotFoundError | ActiveLoanRemovalError | DatabaseError, DbService>
}

// ===== Service Tag =====

export class BookService extends Context.Tag('BookService')<BookService, BookServiceInterface>() { }

// ===== Live Implementation =====

export const BookServiceLive = Layer.effect(
  BookService,
  Effect.gen(function* () {
    const bookRepo = yield* BookRepository
    const locationRepo = yield* LocationRepository

    const normalizeISBN = (isbn: string) => isbn.replace(/[-\s]/g, '')
    const withDebugTiming = <A, E, R>(
      operation: string,
      isbn: string,
      effect: Effect.Effect<A, E, R>
    ): Effect.Effect<A, E, R> =>
      Effect.gen(function* () {
        const start = yield* Effect.sync(() => Date.now())
        const result = yield* effect
        const durationMs = yield* Effect.sync(() => Date.now() - start)
        yield* Effect.logDebug(`${operation} completed`).pipe(
          Effect.annotateLogs({
            operation,
            isbn,
            durationMs
          })
        )
        return result
      })

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
          const selectedLocation = pagination.locationId
            ? yield* locationRepo.getLocationById(userId, pagination.locationId)
            : null
          const result = yield* bookRepo.getLibrary(userId, {
            ...pagination,
            locationPath: selectedLocation?.path
          })

          return {
            items: result.items.map(toLibraryBook),
            pagination: result.pagination
          }
        }),

      addBookToLibrary: (userId, isbn, libraryState = 'owned') =>
        Effect.gen(function* () {
          const normalizedISBN = normalizeISBN(isbn)
          const userBook = yield* bookRepo.addBookByISBN(userId, normalizedISBN, libraryState)

          return toLibraryBook(userBook)
        }),

      bulkAddBooks: (userId, books) =>
        Effect.gen(function* () {
          const added: Array<{ isbn: string }> = []
          const failed: Array<{ isbn: string, error: string }> = []
          const normalizedBooks = books.map(book => ({
            isbn: normalizeISBN(book.isbn),
            libraryState: book.libraryState ?? 'owned' as LibraryState
          }))

          const results = yield* Effect.forEach(
            normalizedBooks,
            book => Effect.either(
              bookRepo.addBookByISBN(userId, book.isbn, book.libraryState).pipe(
                Effect.map(() => ({ isbn: book.isbn }))
              )
            ),
            { concurrency: 3 }
          )

          results.forEach((result, index) => {
            const isbn = normalizedBooks[index]!.isbn
            if (Either.isRight(result)) {
              added.push({ isbn })
            } else {
              const error = result.left
              const message = '_tag' in error ? String(error._tag) : 'Unknown error'
              failed.push({ isbn, error: message })
            }
          })

          return { added, failed }
        }),

      createManualBook: (userId, input) =>
        Effect.gen(function* () {
          const isWishlisted = input.libraryState === 'wishlisted'
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
            rating: isWishlisted ? null : input.rating,
            note: input.note,
            libraryState: input.libraryState,
            readingStatus: isWishlisted ? 'unread' : input.readingStatus,
            currentPage: isWishlisted ? null : input.currentPage,
            progressPercent: isWishlisted ? null : input.progressPercent,
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

      repairMissingOpenLibraryCovers: (limit = 20) =>
        Effect.gen(function* () {
          const normalizedLimit = Number.isFinite(limit) ? Math.floor(limit) : 20
          const cappedLimit = Math.min(Math.max(1, normalizedLimit), 50)
          const candidates = yield* bookRepo.listOpenLibraryBooksMissingCovers(cappedLimit)
          const result: RepairOpenLibraryCoversResult = {
            attempted: candidates.length,
            repaired: 0,
            skipped: 0,
            failed: 0
          }

          yield* Effect.forEach(
            candidates,
            candidate =>
              Effect.gen(function* () {
                const coverPath = yield* downloadCover(candidate.isbn, 'L')
                if (!coverPath) {
                  result.skipped += 1
                  return
                }

                const updated = yield* bookRepo.updateOpenLibraryCoverPath(candidate.id, coverPath)
                if (updated) {
                  result.repaired += 1
                } else {
                  result.skipped += 1
                }
              }).pipe(
                Effect.catchAll(error =>
                  Effect.logWarning(`Failed to repair Open Library cover for ISBN ${candidate.isbn}: ${String(error)}`).pipe(
                    Effect.zipRight(Effect.sync(() => {
                      result.failed += 1
                    }))
                  )
                )
              ),
            { concurrency: 1 }
          )

          return result
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
          const normalizedISBN = normalizeISBN(isbn)
          const existingInUserLibrary = yield* bookRepo.hasBookInUserLibrary(userId, normalizedISBN)

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
              existsLocally: Boolean(existingInUserLibrary),
              existingUserBookId: existingInUserLibrary?.userBookId ?? null,
              existingState: existingInUserLibrary?.libraryState ?? null
            } satisfies BookLookupResult
          }

          // Not found locally, persist OpenLibrary metadata for later add flows.
          const lookupEffect = withDebugTiming(
            'lookupBook.ensureOpenLibraryBook',
            normalizedISBN,
            bookRepo.ensureOpenLibraryBook(normalizedISBN)
          ).pipe(
            Effect.flatMap(book =>
              Effect.gen(function* () {
                const bookTags = yield* withDebugTiming(
                  'lookupBook.systemTagLoad',
                  normalizedISBN,
                  bookRepo.getSystemTagsByBookId(book.id)
                )

                return {
                  found: true,
                  isbn: book.isbn || normalizedISBN,
                  title: book.title,
                  author: book.author,
                  authors: book.authors.map(author => author.name),
                  coverUrl: book.coverPath ? `/api/blob/${book.coverPath}` : null,
                  description: book.description ?? undefined,
                  subjects: bookTags.map(tag => tag.name),
                  publishDate: book.publishDate ?? undefined,
                  publishers: book.publishers ? book.publishers.split(', ') : null,
                  numberOfPages: book.numberOfPages ?? undefined,
                  existsLocally: Boolean(existingInUserLibrary),
                  existingUserBookId: existingInUserLibrary?.userBookId ?? null,
                  existingState: existingInUserLibrary?.libraryState ?? null
                } satisfies BookLookupResult
              })
            ),
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

      updateLocation: (userBookId, userId, locationId) =>
        Effect.gen(function* () {
          const location = locationId
            ? yield* locationRepo.getLocationById(userId, locationId)
            : null
          yield* bookRepo.updateLocation(userBookId, userId, location?.id ?? null)
          return location
        }),

      updateReadingProgress: (userBookId, userId, progress) =>
        Effect.gen(function* () {
          const details = yield* bookRepo.getUserBookWithDetails(userBookId, userId)
          const normalized = yield* normalizeProgress(details, progress)
          yield* bookRepo.updateReadingProgress(userBookId, userId, normalized)
          return normalized
        }),

      updateLibraryState: (userBookId, userId, state) =>
        Effect.gen(function* () {
          const userBook = yield* bookRepo.updateLibraryState(userBookId, userId, state)
          return toLibraryBook(userBook)
        })
    }
  })
)

// ===== Helper Effects =====

export const getUserLibrary = (userId: string, pagination: PaginationParams & LibraryQueryFilters) =>
  Effect.flatMap(BookService, service => service.getUserLibrary(userId, pagination))

export const getAuthorLibrary = (userId: string, authorId: string, pagination: PaginationParams) =>
  Effect.flatMap(BookService, service => service.getAuthorLibrary(userId, authorId, pagination))

export const addBookToLibrary = (userId: string, isbn: string, libraryState?: LibraryState) =>
  Effect.flatMap(BookService, service => service.addBookToLibrary(userId, isbn, libraryState))

export const bulkAddBooks = (userId: string, books: BulkAddBookInput[]) =>
  Effect.flatMap(BookService, service => service.bulkAddBooks(userId, books))

export const createManualBook = (userId: string, input: ManualBookCreateSchema) =>
  Effect.flatMap(BookService, service => service.createManualBook(userId, input))

export const repairMissingOpenLibraryCovers = (limit?: number) =>
  Effect.flatMap(BookService, service => service.repairMissingOpenLibraryCovers(limit))

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

export const updateLocation = (userBookId: string, userId: string, locationId: string | null) =>
  Effect.flatMap(BookService, service => service.updateLocation(userBookId, userId, locationId))

export const updateReadingProgress = (
  userBookId: string,
  userId: string,
  progress: BookReadingProgressSchema
) =>
  Effect.flatMap(BookService, service => service.updateReadingProgress(userBookId, userId, progress))

export const updateLibraryState = (userBookId: string, userId: string, state: LibraryState) =>
  Effect.flatMap(BookService, service => service.updateLibraryState(userBookId, userId, state))
