import { Context, Effect, Layer, Data } from 'effect'
import type * as HttpClient from '@effect/platform/HttpClient'
import { eq, and, count, desc, asc, inArray, or, sql, notInArray, exists, isNull, not } from 'drizzle-orm'
import { books, authors, bookAuthors, userBooks, tags, bookSystemTags, userBookTags, loans, user, locations } from 'hub:db:schema'
import { normalizeTagInput, normalizeSuggestedTags } from '../../shared/utils/tag-ingestion'
import type { LibraryQueryFilters } from '../../shared/utils/library-query'
import { escapeLocationLikePattern } from '../../shared/utils/location-hierarchy'
import { DbService } from '../services/db.service'
import type { AtomicDbStatement, AtomicDbStatements } from '../services/db.service'
import { getBlob, type StorageService } from '../services/storage.service'
import { downloadCover, lookupByISBN } from './openLibrary.repository'
import type { OpenLibraryApiError, OpenLibraryBookNotFoundError, OpenLibraryRepository } from './openLibrary.repository'
import type { LibraryState, TagWithCount } from '../../shared/types/book'

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
  userBookId?: string
  libraryState?: LibraryState
}> { }

export class BookNotOwnedError extends Data.TaggedError('BookNotOwnedError')<{
  userBookId: string
  libraryState: LibraryState
}> { }

export class DatabaseError extends Data.TaggedError('DatabaseError')<{
  message: string
  operation: string
}> { }

export class InvalidTagError extends Data.TaggedError('InvalidTagError')<{
  message: string
}> { }

export class ActiveLoanRemovalError extends Data.TaggedError('ActiveLoanRemovalError')<{
  userBookId: string
  borrowerDisplayName: string
}> { }

// Output types
export interface Book {
  id: string
  isbn: string | null
  title: string
  author: string
  authors: RepositoryBookAuthor[]
  coverPath: string | null
  openLibraryKey: string | null
  createdAt: Date
  description?: string | null
  publishDate?: string | null
  publishers?: string | null
  numberOfPages?: number | null
  workKey?: string | null
  source: 'open_library' | 'manual'
  createdByUserId: string | null
}

export interface UserBook {
  id: string
  bookId: string
  libraryState: LibraryState
  book: Book
  location: BookLocation | null
  lastKnownLocation: string | null
  tags: string[]
  addedAt: Date
  activeLoan: ActiveLoanSummary | null
}

export interface BookTagRecord {
  id: string
  name: string
}

export interface MissingOpenLibraryCoverBook {
  id: string
  isbn: string
}

interface RepositoryBookAuthor {
  id: string
  name: string
}

export interface AuthorLibraryResult extends PaginatedResult<UserBook> {
  author: RepositoryBookAuthor
}

interface OwnedUserBookRef {
  userBookId: string
  bookId: string
}

export interface ManualBookRepositoryInput {
  title: string
  authors: string[]
  isbn: string | null
  coverPath: string | null
  publishDate: string | null
  publisher: string | null
  numberOfPages: number | null
  rating: number | null
  note: string | null
  readingStatus: ReadingStatus
  libraryState: LibraryState
  currentPage: number | null
  progressPercent: number | null
  tags: string[]
}

export interface BookLibraryFilters extends LibraryQueryFilters {
  locationPath?: string
}

// Service interface
export interface BookRepositoryInterface {
  ensureOpenLibraryBook: (
    isbn: string
  ) => Effect.Effect<
    Book,
    BookCreateError | OpenLibraryBookNotFoundError | OpenLibraryApiError | DatabaseError,
    DbService | StorageService | OpenLibraryRepository | HttpClient.HttpClient
  >

  addBookByISBN: (
    userId: string,
    isbn: string,
    libraryState?: LibraryState
  ) => Effect.Effect<
    UserBook,
    BookCreateError | BookAlreadyOwnedError | OpenLibraryBookNotFoundError | OpenLibraryApiError | DatabaseError,
    DbService | StorageService | OpenLibraryRepository | HttpClient.HttpClient
  >

  createManualBook: (
    userId: string,
    input: ManualBookRepositoryInput
  ) => Effect.Effect<UserBook, BookCreateError | DatabaseError, DbService>

  getLibrary: (
    userId: string,
    pagination: PaginationParams & BookLibraryFilters
  ) => Effect.Effect<PaginatedResult<UserBook>, DatabaseError, DbService>

  listTags: (userId: string) => Effect.Effect<TagWithCount[], DatabaseError, DbService>

  getLibraryByAuthor: (
    userId: string,
    authorId: string,
    pagination: PaginationParams
  ) => Effect.Effect<AuthorLibraryResult, BookNotFoundError | DatabaseError, DbService>

  getBookById: (bookId: string) => Effect.Effect<Book, BookNotFoundError | DatabaseError, DbService>

  listOpenLibraryBooksMissingCovers: (
    limit: number
  ) => Effect.Effect<MissingOpenLibraryCoverBook[], DatabaseError, DbService>

  updateOpenLibraryCoverPath: (
    bookId: string,
    coverPath: string
  ) => Effect.Effect<boolean, DatabaseError, DbService>

  hasBookInUserLibrary: (
    userId: string,
    isbn: string
  ) => Effect.Effect<{ userBookId: string, libraryState: LibraryState } | null, DatabaseError, DbService>

  userOwnsManualCover: (
    userId: string,
    pathname: string
  ) => Effect.Effect<boolean, DatabaseError, DbService>

  removeFromLibrary: (
    userBookId: string,
    userId: string,
    options?: { confirmActiveLoan?: boolean }
  ) => Effect.Effect<void, BookNotFoundError | ActiveLoanRemovalError | DatabaseError, DbService>

  findByIsbn: (
    isbn: string
  ) => Effect.Effect<Book | null, DatabaseError, DbService>

  getSystemTagsByBookId: (
    bookId: string
  ) => Effect.Effect<BookTagRecord[], DatabaseError, DbService>

  getUserBookWithDetails: (
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
  ) => Effect.Effect<BookTagRecord, BookNotFoundError | InvalidTagError | DatabaseError, DbService>

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
  ) => Effect.Effect<void, BookNotFoundError | BookNotOwnedError | DatabaseError, DbService>

  updateReadingProgress: (
    userBookId: string,
    userId: string,
    progress: ReadingProgress
  ) => Effect.Effect<void, BookNotFoundError | BookNotOwnedError | DatabaseError, DbService>

  updateLibraryState: (
    userBookId: string,
    userId: string,
    state: LibraryState
  ) => Effect.Effect<UserBook, BookNotFoundError | ActiveLoanRemovalError | DatabaseError, DbService>
}

// Service tag
export class BookRepository extends Context.Tag('BookRepository')<BookRepository, BookRepositoryInterface>() { }

// Generate unique ID
function generateId(): string {
  return crypto.randomUUID()
}

function normalizeISBN(isbn: string): string {
  return isbn.replace(/[-\s]/g, '')
}

const TRUSTED_COVER_EXTENSIONS = new Set(['webp', 'jpg', 'jpeg', 'png', 'gif'])

function validateManualCoverPath(userId: string, coverPath: string | null): string | null {
  if (!coverPath) return null

  const expectedPrefix = `covers/manual/${userId}/`
  const extension = coverPath.split('.').pop()?.toLowerCase()
  if (
    !coverPath.startsWith(expectedPrefix)
    || coverPath.length <= expectedPrefix.length
    || coverPath.includes('..')
    || coverPath.slice(expectedPrefix.length).includes('/')
    || !extension
    || !TRUSTED_COVER_EXTENSIONS.has(extension)
  ) {
    throw new BookCreateError({ message: 'Manual cover path is invalid' })
  }

  return coverPath
}

function findStoredOpenLibraryCover(isbn: string) {
  const normalizedISBN = normalizeISBN(isbn)
  const candidatePaths = [...TRUSTED_COVER_EXTENSIONS].map(extension => `covers/${normalizedISBN}.${extension}`)

  return Effect.gen(function* () {
    for (const candidatePath of candidatePaths) {
      const foundPath = yield* getBlob(candidatePath).pipe(
        Effect.map(blob => blob ? candidatePath : null),
        Effect.catchAll(error =>
          Effect.logWarning(`Stored Open Library cover ${candidatePath} could not be verified: ${String(error)}`).pipe(
            Effect.as(null)
          )
        )
      )

      if (foundPath) {
        return foundPath
      }
    }

    return null
  })
}

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

// Live implementation
export const BookRepositoryLive = Layer.effect(
  BookRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    const normalizeAuthorName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()
    const formatAuthorList = (bookAuthorList: RepositoryBookAuthor[]) =>
      bookAuthorList.length > 0 ? bookAuthorList.map(author => author.name).join(', ') : 'Unknown Author'

    const toBookModel = (book: typeof books.$inferSelect, bookAuthorList: RepositoryBookAuthor[]): Book => ({
      id: book.id,
      isbn: book.isbn,
      title: book.title,
      author: formatAuthorList(bookAuthorList),
      authors: bookAuthorList,
      coverPath: book.coverPath,
      openLibraryKey: book.openLibraryKey,
      createdAt: book.createdAt instanceof Date ? book.createdAt : new Date(book.createdAt as unknown as string),
      description: book.description,
      publishDate: book.publishDate,
      publishers: book.publishers,
      numberOfPages: book.numberOfPages,
      workKey: book.workKey,
      source: book.source,
      createdByUserId: book.createdByUserId
    })

    const toLocationModel = (location: typeof locations.$inferSelect | null): BookLocation | null => {
      if (!location) return null

      return {
        id: location.id,
        name: location.name,
        parentLocationId: location.parentLocationId ?? null,
        path: location.path,
        depth: location.depth
      }
    }

    const hydrateAuthorsForBookIds = (bookIds: string[]) =>
      Effect.gen(function* () {
        if (bookIds.length === 0) return new Map<string, RepositoryBookAuthor[]>()

        const rows = yield* Effect.tryPromise({
          try: () => dbService.db
            .select({
              bookId: bookAuthors.bookId,
              id: authors.id,
              name: authors.name
            })
            .from(bookAuthors)
            .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
            .where(inArray(bookAuthors.bookId, bookIds))
            .orderBy(asc(bookAuthors.sortOrder), asc(authors.name)),
          catch: error => new DatabaseError({
            message: `Failed to load authors: ${error}`,
            operation: 'hydrateAuthorsForBookIds'
          })
        })

        const authorMap = new Map<string, RepositoryBookAuthor[]>()
        for (const row of rows) {
          const list = authorMap.get(row.bookId) || []
          list.push({ id: row.id, name: row.name })
          authorMap.set(row.bookId, list)
        }

        return authorMap
      })

    const loadOpenLibraryBookByIsbn = (isbn: string, operation: string) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () =>
            dbService.db
              .select()
              .from(books)
              .where(and(eq(books.isbn, isbn), eq(books.source, 'open_library')))
              .limit(1),
          catch: error => new DatabaseError({
            message: `Failed to find existing book: ${error}`,
            operation
          })
        })

        return result[0] || null
      })

    const resolveOrCreateAuthorId = (name: string, client = dbService.db) =>
      Effect.gen(function* () {
        const displayName = name.trim().replace(/\s+/g, ' ') || 'Unknown Author'
        const normalizedName = normalizeAuthorName(displayName)

        const existing = yield* Effect.tryPromise({
          try: () => client
            .select({ id: authors.id })
            .from(authors)
            .where(eq(authors.normalizedName, normalizedName))
            .limit(1),
          catch: error => new DatabaseError({
            message: `Failed to find author: ${error}`,
            operation: 'resolveOrCreateAuthorId.find'
          })
        })

        if (existing[0]) {
          return existing[0].id
        }

        const now = new Date()
        const newAuthorId = generateId()

        yield* Effect.tryPromise({
          try: () => client
            .insert(authors)
            .values({
              id: newAuthorId,
              name: displayName,
              normalizedName,
              createdAt: now,
              updatedAt: now
            })
            .onConflictDoNothing(),
          catch: error => new DatabaseError({
            message: `Failed to create author: ${error}`,
            operation: 'resolveOrCreateAuthorId.create'
          })
        })

        const found = yield* Effect.tryPromise({
          try: () => client
            .select({ id: authors.id })
            .from(authors)
            .where(eq(authors.normalizedName, normalizedName))
            .limit(1),
          catch: error => new DatabaseError({
            message: `Failed to resolve author after insert: ${error}`,
            operation: 'resolveOrCreateAuthorId.resolve'
          })
        })

        const author = found[0]
        if (!author) {
          return yield* Effect.fail(new DatabaseError({
            message: `Author upsert failed for name: ${displayName}`,
            operation: 'resolveOrCreateAuthorId.final'
          }))
        }

        return author.id
      })

    const linkBookAuthor = (bookId: string, authorId: string, sortOrder: number, client = dbService.db) =>
      Effect.tryPromise({
        try: () => client
          .insert(bookAuthors)
          .values({
            bookId,
            authorId,
            sortOrder,
            createdAt: new Date()
          })
          .onConflictDoNothing(),
        catch: error => new DatabaseError({
          message: `Failed to link author to book: ${error}`,
          operation: 'linkBookAuthor'
        })
      })

    const setBookAuthors = (bookId: string, authorNames: string[]) =>
      Effect.gen(function* () {
        const normalizedSeen = new Set<string>()
        const uniqueNames = authorNames
          .map(name => name.trim().replace(/\s+/g, ' '))
          .filter((name) => {
            const normalized = normalizeAuthorName(name)
            if (!normalized || normalizedSeen.has(normalized)) return false
            normalizedSeen.add(normalized)
            return true
          })

        const names = uniqueNames.length > 0 ? uniqueNames : ['Unknown Author']

        for (const [index, name] of names.entries()) {
          const authorId = yield* resolveOrCreateAuthorId(name)
          yield* linkBookAuthor(bookId, authorId, index)
        }
      })

    const resolveOrCreateTagId = (normalizedTag: { key: string, displayName: string }, client = dbService.db) =>
      Effect.gen(function* () {
        const existing = yield* Effect.tryPromise({
          try: () => client
            .select({ id: tags.id })
            .from(tags)
            .where(eq(tags.normalizedName, normalizedTag.key))
            .limit(1),
          catch: error => new DatabaseError({
            message: `Failed to find tag: ${error}`,
            operation: 'resolveOrCreateTagId.find'
          })
        })

        if (existing[0]) {
          return existing[0].id
        }

        const now = new Date()
        const newTagId = generateId()

        yield* Effect.tryPromise({
          try: () => client
            .insert(tags)
            .values({
              id: newTagId,
              name: normalizedTag.displayName,
              normalizedName: normalizedTag.key,
              createdAt: now,
              updatedAt: now
            })
            .onConflictDoNothing(),
          catch: error => new DatabaseError({
            message: `Failed to create tag: ${error}`,
            operation: 'resolveOrCreateTagId.create'
          })
        })

        const found = yield* Effect.tryPromise({
          try: () => client
            .select({ id: tags.id })
            .from(tags)
            .where(eq(tags.normalizedName, normalizedTag.key))
            .limit(1),
          catch: error => new DatabaseError({
            message: `Failed to resolve tag after insert: ${error}`,
            operation: 'resolveOrCreateTagId.resolve'
          })
        })

        const tag = found[0]
        if (!tag) {
          return yield* Effect.fail(new DatabaseError({
            message: `Tag upsert failed for key: ${normalizedTag.key}`,
            operation: 'resolveOrCreateTagId.final'
          }))
        }

        return tag.id
      })

    const linkSystemTag = (bookId: string, tagId: string, client = dbService.db) =>
      Effect.tryPromise({
        try: () => client
          .insert(bookSystemTags)
          .values({
            bookId,
            tagId,
            createdAt: new Date(),
            updatedAt: new Date()
          })
          .onConflictDoNothing(),
        catch: error => new DatabaseError({
          message: `Failed to link system tag to book: ${error}`,
          operation: 'linkSystemTag'
        })
      })

    const hydrateSystemTagsForBook = (bookId: string, subjects: string[]) =>
      Effect.gen(function* () {
        const suggestedTags = normalizeSuggestedTags(subjects)
        for (const suggestedTag of suggestedTags) {
          const tagId = yield* resolveOrCreateTagId(suggestedTag)
          yield* linkSystemTag(bookId, tagId)
        }
      })

    const hasAuthorsForBook = (bookId: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.tryPromise({
          try: () => dbService.db
            .select({ value: count() })
            .from(bookAuthors)
            .where(eq(bookAuthors.bookId, bookId)),
          catch: error => new DatabaseError({
            message: `Failed to count book authors: ${error}`,
            operation: 'hasAuthorsForBook'
          })
        })

        return (rows[0]?.value ?? 0) > 0
      })

    const hasSystemTagsForBook = (bookId: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.tryPromise({
          try: () => dbService.db
            .select({ value: count() })
            .from(bookSystemTags)
            .where(eq(bookSystemTags.bookId, bookId)),
          catch: error => new DatabaseError({
            message: `Failed to count system tags: ${error}`,
            operation: 'hasSystemTagsForBook'
          })
        })

        return (rows[0]?.value ?? 0) > 0
      })

    const hydrateMissingOpenLibraryMetadataForBook = (bookId: string, isbn: string) =>
      Effect.gen(function* () {
        const hasSystemTags = yield* hasSystemTagsForBook(bookId)
        if (hasSystemTags) return

        const hasAuthors = yield* hasAuthorsForBook(bookId)
        const data = yield* lookupByISBN(isbn)
        yield* hydrateSystemTagsForBook(bookId, data.subjects || [])
        if (!hasAuthors) {
          yield* setBookAuthors(bookId, data.authors)
        }
      }).pipe(
        Effect.catchAll(error =>
          Effect.logWarning(`Skipped Open Library metadata hydration for existing ISBN ${isbn}: ${String(error)}`)
        )
      )

    const linkUserTag = (userBookId: string, tagId: string, client = dbService.db) =>
      Effect.tryPromise({
        try: () => client
          .insert(userBookTags)
          .values({
            id: generateId(),
            userBookId,
            tagId,
            createdAt: new Date(),
            updatedAt: new Date()
          })
          .onConflictDoNothing(),
        catch: error => new DatabaseError({
          message: `Failed to link user tag to user book: ${error}`,
          operation: 'linkUserTag'
        })
      })

    const hydrateUserTagsByUserBookIds = (userBookIds: string[]) =>
      Effect.gen(function* () {
        if (userBookIds.length === 0) return new Map<string, string[]>()

        const rows = yield* Effect.tryPromise({
          try: () => dbService.db
            .select({
              userBookId: userBookTags.userBookId,
              tagName: tags.name
            })
            .from(userBookTags)
            .innerJoin(tags, eq(userBookTags.tagId, tags.id))
            .where(inArray(userBookTags.userBookId, userBookIds)),
          catch: error => new DatabaseError({
            message: `Failed to load user tags: ${error}`,
            operation: 'hydrateUserTagsByUserBookIds'
          })
        })

        const tagMap = new Map<string, string[]>()
        for (const row of rows) {
          const list = tagMap.get(row.userBookId) || []
          list.push(row.tagName)
          tagMap.set(row.userBookId, list)
        }

        return tagMap
      })

    const getOwnedUserBookRef = (userBookId: string, userId: string, client = dbService.db) =>
      Effect.gen(function* () {
        const row = yield* Effect.tryPromise({
          try: () => client
            .select({
              userBookId: userBooks.id,
              bookId: userBooks.bookId
            })
            .from(userBooks)
            .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
            .limit(1),
          catch: error => new DatabaseError({
            message: `Failed to validate user book ownership: ${error}`,
            operation: 'getOwnedUserBookRef'
          })
        })

        const owned = row[0]
        if (!owned) {
          return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
        }

        return owned as OwnedUserBookRef
      })

    const getOwnedPhysicalUserBookRef = (userBookId: string, userId: string, client = dbService.db) =>
      Effect.gen(function* () {
        const ref = yield* getOwnedUserBookRef(userBookId, userId, client)
        const row = yield* Effect.tryPromise({
          try: () => client
            .select({
              libraryState: userBooks.libraryState
            })
            .from(userBooks)
            .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
            .limit(1),
          catch: error => new DatabaseError({
            message: `Failed to validate library state: ${error}`,
            operation: 'getOwnedPhysicalUserBookRef'
          })
        })

        const libraryState = row[0]?.libraryState as LibraryState | undefined
        if (libraryState && libraryState !== 'owned') {
          return yield* Effect.fail(new BookNotOwnedError({ userBookId, libraryState }))
        }

        return ref
      })

    const hydrateActiveLoansByUserBookIds = (userBookIds: string[]) =>
      Effect.gen(function* () {
        if (userBookIds.length === 0) return new Map<string, ActiveLoanSummary>()

        const rows = yield* Effect.tryPromise({
          try: () => dbService.db
            .select({
              userBookId: loans.userBookId,
              id: loans.id,
              borrowerDisplayName: loans.borrowerDisplayName,
              acceptedByName: user.name,
              loanedAt: loans.loanedAt,
              dueAt: loans.dueAt,
              acceptedAt: loans.acceptedAt
            })
            .from(loans)
            .leftJoin(user, eq(loans.borrowerUserId, user.id))
            .where(and(inArray(loans.userBookId, userBookIds), eq(loans.status, 'active'))),
          catch: error => new DatabaseError({
            message: `Failed to load active loans: ${error}`,
            operation: 'hydrateActiveLoansByUserBookIds'
          })
        })

        return new Map(rows.map(row => [row.userBookId, {
          id: row.id,
          borrowerDisplayName: row.borrowerDisplayName,
          acceptedByName: row.acceptedByName ?? null,
          loanedAt: row.loanedAt,
          dueAt: row.dueAt ?? null,
          acceptedAt: row.acceptedAt ?? null
        }]))
      })

    const ensureOpenLibraryBook = (isbn: string) =>
      Effect.gen(function* () {
        const normalizedISBN = normalizeISBN(isbn)
        const existingBook = yield* loadOpenLibraryBookByIsbn(normalizedISBN, 'ensureOpenLibraryBook.findExisting')

        if (!existingBook) {
          const openLibraryData = yield* withDebugTiming(
            'ensureOpenLibraryBook.openLibraryMetadataFetch',
            normalizedISBN,
            lookupByISBN(normalizedISBN)
          )

          const coverPath = yield* withDebugTiming(
            'ensureOpenLibraryBook.coverResolution',
            normalizedISBN,
            Effect.gen(function* () {
              return (yield* findStoredOpenLibraryCover(normalizedISBN))
                ?? (yield* downloadCover(normalizedISBN, 'L'))
            })
          )

          const newBookId = generateId()
          const now = new Date()
          const newBook = {
            id: newBookId,
            isbn: normalizedISBN,
            title: openLibraryData.title,
            coverPath,
            openLibraryKey: openLibraryData.openLibraryKey,
            workKey: openLibraryData.workKey || null,
            description: openLibraryData.description || null,
            publishDate: openLibraryData.publishDate || null,
            publishers: openLibraryData.publishers?.join(', ') || null,
            numberOfPages: openLibraryData.numberOfPages || null,
            source: 'open_library' as const,
            createdByUserId: null,
            createdAt: now
          }

          yield* withDebugTiming(
            'ensureOpenLibraryBook.bookInsert',
            normalizedISBN,
            Effect.tryPromise({
              try: () => dbService.db.run(sql`
                INSERT INTO ${books} (
                  "id",
                  "isbn",
                  "title",
                  "cover_path",
                  "open_library_key",
                  "work_key",
                  "description",
                  "publish_date",
                  "publishers",
                  "number_of_pages",
                  "source",
                  "created_by_user_id",
                  "created_at"
                )
                VALUES (
                  ${sql.param(newBook.id, books.id)},
                  ${sql.param(newBook.isbn, books.isbn)},
                  ${sql.param(newBook.title, books.title)},
                  ${sql.param(newBook.coverPath, books.coverPath)},
                  ${sql.param(newBook.openLibraryKey, books.openLibraryKey)},
                  ${sql.param(newBook.workKey, books.workKey)},
                  ${sql.param(newBook.description, books.description)},
                  ${sql.param(newBook.publishDate, books.publishDate)},
                  ${sql.param(newBook.publishers, books.publishers)},
                  ${sql.param(newBook.numberOfPages, books.numberOfPages)},
                  ${sql.param(newBook.source, books.source)},
                  ${sql.param(newBook.createdByUserId, books.createdByUserId)},
                  ${sql.param(newBook.createdAt, books.createdAt)}
                )
                ON CONFLICT ("isbn")
                WHERE "source" = 'open_library' AND "isbn" IS NOT NULL
                DO NOTHING
              `),
              catch: error => new BookCreateError({ message: `Failed to insert book: ${error}` })
            })
          )

          const book = yield* loadOpenLibraryBookByIsbn(normalizedISBN, 'ensureOpenLibraryBook.reselect')
          if (!book) {
            return yield* Effect.fail(new BookCreateError({ message: `Failed to resolve persisted book for ISBN ${normalizedISBN}` }))
          }

          yield* withDebugTiming(
            'ensureOpenLibraryBook.authorHydration',
            normalizedISBN,
            setBookAuthors(book.id, openLibraryData.authors)
          )

          yield* withDebugTiming(
            'ensureOpenLibraryBook.systemTagHydration',
            normalizedISBN,
            hydrateSystemTagsForBook(book.id, openLibraryData.subjects || [])
          )

          const authorMap = yield* hydrateAuthorsForBookIds([book.id])
          return toBookModel(book, authorMap.get(book.id) || [])
        }

        let book = existingBook
        if (!book.coverPath) {
          const coverPath = yield* withDebugTiming(
            'ensureOpenLibraryBook.coverResolution',
            normalizedISBN,
            Effect.gen(function* () {
              const storedCoverPath = yield* findStoredOpenLibraryCover(normalizedISBN)
              if (storedCoverPath) return storedCoverPath

              const hasSystemTags = yield* hasSystemTagsForBook(book.id)
              return hasSystemTags ? null : yield* downloadCover(normalizedISBN, 'L')
            })
          )

          if (coverPath) {
            const updated = yield* Effect.tryPromise({
              try: async () => {
                const rows = await dbService.db
                  .update(books)
                  .set({ coverPath })
                  .where(and(eq(books.id, book.id), isNull(books.coverPath)))
                  .returning()
                return rows[0] ?? null
              },
              catch: error => new DatabaseError({
                message: `Failed to update existing book cover: ${error}`,
                operation: 'ensureOpenLibraryBook.updateExistingCover'
              })
            })
            if (updated) {
              book = updated
            }
          }
        }

        yield* withDebugTiming(
          'ensureOpenLibraryBook.systemTagHydration',
          normalizedISBN,
          hydrateMissingOpenLibraryMetadataForBook(book.id, normalizedISBN)
        )

        const authorMap = yield* hydrateAuthorsForBookIds([book.id])
        return toBookModel(book, authorMap.get(book.id) || [])
      })

    return {
      ensureOpenLibraryBook,

      addBookByISBN: (userId, isbn, libraryState = 'owned') =>
        Effect.gen(function* () {
          const normalizedISBN = normalizeISBN(isbn)

          // Check if user already owns a book with this ISBN
          const existingResult = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select({
                  userBookId: userBooks.id,
                  libraryState: userBooks.libraryState
                })
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .where(and(
                  eq(userBooks.userId, userId),
                  eq(books.isbn, normalizedISBN),
                  eq(books.source, 'open_library'),
                  isNull(userBooks.removedAt)
                ))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to check existing ownership: ${error}`,
              operation: 'addBookByISBN.checkExisting'
            })
          })

          const existing = existingResult[0]
          if (existing) {
            return yield* Effect.fail(new BookAlreadyOwnedError({
              isbn: normalizedISBN,
              userBookId: existing.userBookId,
              libraryState: existing.libraryState as LibraryState
            }))
          }

          const book = yield* ensureOpenLibraryBook(normalizedISBN)

          // Create userBooks entry
          const userBookId = generateId()
          const addedAt = new Date()

          yield* Effect.tryPromise({
            try: () =>
              dbService.db.insert(userBooks).values({
                id: userBookId,
                userId,
                bookId: book.id,
                libraryState,
                addedAt
              }),
            catch: error => new BookCreateError({ message: `Failed to add book to library: ${error}` })
          })

          return {
            id: userBookId,
            bookId: book.id,
            libraryState,
            book,
            location: null,
            lastKnownLocation: null,
            tags: [],
            addedAt,
            activeLoan: null
          }
        }),

      createManualBook: (userId, input) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              const now = new Date()
              const bookId = generateId()
              const userBookId = generateId()
              const coverPath = validateManualCoverPath(userId, input.coverPath)
              const newBook = {
                id: bookId,
                isbn: input.isbn,
                title: input.title,
                coverPath,
                openLibraryKey: null,
                workKey: null,
                description: null,
                publishDate: input.publishDate,
                publishers: input.publisher,
                numberOfPages: input.numberOfPages,
                source: 'manual' as const,
                createdByUserId: userId,
                createdAt: now
              }

              const normalizedSeen = new Set<string>()
              const manualAuthorNames = input.authors.filter((name) => {
                const normalized = normalizeAuthorName(name)
                if (!normalized || normalizedSeen.has(normalized)) return false
                normalizedSeen.add(normalized)
                return true
              })
              const authorNames = manualAuthorNames.length > 0 ? manualAuthorNames : ['Unknown Author']
              const authorInputs = authorNames.map((authorName, index) => {
                const displayName = authorName.trim().replace(/\s+/g, ' ')
                return {
                  id: generateId(),
                  displayName,
                  normalizedName: normalizeAuthorName(displayName),
                  sortOrder: index
                }
              })

              const uniqueTagNames = [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))]
              const tagInputs = uniqueTagNames
                .map((tagName) => {
                  const normalized = normalizeTagInput(tagName)
                  return normalized
                    ? {
                        id: generateId(),
                        displayName: normalized.displayName,
                        normalizedName: normalized.key,
                        userBookTagId: generateId()
                      }
                    : null
                })
                .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
              const isWishlisted = input.libraryState === 'wishlisted'

              await dbService.executeAtomic((database) => {
                const statements: AtomicDbStatement[] = [
                  database.insert(books).values(newBook)
                ]

                for (const author of authorInputs) {
                  statements.push(
                    database.insert(authors).values({
                      id: author.id,
                      name: author.displayName,
                      normalizedName: author.normalizedName,
                      createdAt: now,
                      updatedAt: now
                    }).onConflictDoNothing(),
                    database.insert(bookAuthors).values({
                      bookId,
                      authorId: sql<string>`(SELECT id FROM authors WHERE normalized_name = ${author.normalizedName})` as unknown as string,
                      sortOrder: author.sortOrder,
                      createdAt: now
                    }).onConflictDoNothing()
                  )
                }

                statements.push(database.insert(userBooks).values({
                  id: userBookId,
                  userId,
                  bookId,
                  rating: isWishlisted ? null : input.rating,
                  note: input.note,
                  libraryState: input.libraryState,
                  readingStatus: isWishlisted ? 'unread' : input.readingStatus,
                  currentPage: isWishlisted ? null : input.currentPage,
                  progressPercent: isWishlisted ? null : input.progressPercent,
                  addedAt: now
                }))

                for (const tag of tagInputs) {
                  statements.push(
                    database.insert(tags).values({
                      id: tag.id,
                      name: tag.displayName,
                      normalizedName: tag.normalizedName,
                      createdAt: now,
                      updatedAt: now
                    }).onConflictDoNothing(),
                    database.insert(userBookTags).values({
                      id: tag.userBookTagId,
                      userBookId,
                      tagId: sql<string>`(SELECT id FROM tags WHERE normalized_name = ${tag.normalizedName})` as unknown as string,
                      createdAt: now,
                      updatedAt: now
                    }).onConflictDoNothing()
                  )
                }

                return statements as unknown as AtomicDbStatements
              })

              const createdRows = await dbService.db
                .select()
                .from(books)
                .where(eq(books.id, bookId))
                .limit(1)

              const createdBook = createdRows[0]
              if (!createdBook) {
                throw new DatabaseError({
                  message: 'Manual book created but not found afterwards',
                  operation: 'createManualBook.loadBook'
                })
              }

              const authorRows = await dbService.db
                .select({
                  id: authors.id,
                  name: authors.name
                })
                .from(bookAuthors)
                .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
                .where(eq(bookAuthors.bookId, bookId))
                .orderBy(asc(bookAuthors.sortOrder), asc(authors.name))

              const userTagRows = await dbService.db
                .select({ name: tags.name })
                .from(userBookTags)
                .innerJoin(tags, eq(userBookTags.tagId, tags.id))
                .where(eq(userBookTags.userBookId, userBookId))

              return {
                id: userBookId,
                bookId,
                libraryState: input.libraryState,
                book: toBookModel(createdBook, authorRows),
                location: null,
                lastKnownLocation: null,
                tags: userTagRows.map(tag => tag.name),
                addedAt: now,
                activeLoan: null
              }
            },
            catch: (error) => {
              if (error instanceof DatabaseError) {
                return error
              }

              return new BookCreateError({ message: `Failed to create manual book: ${error}` })
            }
          })
          return result
        }),

      getLibrary: (userId, pagination) =>
        Effect.gen(function* () {
          const { page, pageSize } = pagination
          const offset = (page - 1) * pageSize
          const normalizedSearch = pagination.search?.trim().toLowerCase()
          const hasSearch = Boolean(normalizedSearch)
          const likePattern = `%${normalizedSearch}%`
          const hasSelectedTags = Boolean(pagination.tags?.length)
          const rawTagFilters = hasSelectedTags ? pagination.tags! : [pagination.tag]
          const normalizedTags = [...new Set(rawTagFilters
            .filter((tag): tag is string => Boolean(tag?.trim()))
            .map(tag => tag.trim().toLowerCase()))]
          const normalizedLocation = pagination.location?.trim().toLowerCase()
          const selectedLocationPath = pagination.locationPath?.trim()
          const selectedLocationDescendantPattern = selectedLocationPath
            ? `${escapeLocationLikePattern(selectedLocationPath)} - %`
            : undefined
          const activeLoanCondition = exists(
            dbService.db
              .select({ value: sql`1` })
              .from(loans)
              .where(and(eq(loans.userBookId, userBooks.id), eq(loans.status, 'active')))
          )
          // Library tag filters intentionally use user-confirmed tags only.
          // System tags are Open Library suggestions until promoted in the UI.
          // Discrete `tags` selections match exactly; the legacy single `tag`
          // parameter retains its substring behavior for older callers/links.
          const tagCondition = normalizedTags.length
            ? or(...normalizedTags.map(normalizedTag =>
                exists(
                  dbService.db
                    .select({ value: sql`1` })
                    .from(userBookTags)
                    .innerJoin(tags, eq(userBookTags.tagId, tags.id))
                    .where(and(
                      eq(userBookTags.userBookId, userBooks.id),
                      hasSelectedTags
                        ? sql`lower(${tags.name}) = ${normalizedTag}`
                        : sql`lower(${tags.name}) like ${`%${normalizedTag}%`}`
                    ))
                )
              ))
            : undefined

          const searchCondition = hasSearch
            ? or(
                sql`lower(${books.title}) like ${likePattern}`,
                sql`lower(coalesce(${books.isbn}, '')) like ${likePattern}`,
                sql`lower(coalesce(${locations.path}, '')) like ${likePattern}`,
                exists(
                  dbService.db
                    .select({ value: sql`1` })
                    .from(bookAuthors)
                    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
                    .where(and(eq(bookAuthors.bookId, books.id), sql`lower(${authors.name}) like ${likePattern}`))
                ),
                exists(
                  dbService.db
                    .select({ value: sql`1` })
                    .from(userBookTags)
                    .innerJoin(tags, eq(userBookTags.tagId, tags.id))
                    .where(and(eq(userBookTags.userBookId, userBooks.id), sql`lower(${tags.name}) like ${likePattern}`))
                ),
                exists(
                  dbService.db
                    .select({ value: sql`1` })
                    .from(bookSystemTags)
                    .innerJoin(tags, eq(bookSystemTags.tagId, tags.id))
                    .where(and(eq(bookSystemTags.bookId, books.id), sql`lower(${tags.name}) like ${likePattern}`))
                )
              )
            : undefined

          const selectedLibraryStates = pagination.libraryState ?? []
          const libraryStateCondition = selectedLibraryStates.length > 0 && selectedLibraryStates.length < 3
            ? inArray(userBooks.libraryState, selectedLibraryStates)
            : undefined

          const whereClause = and(
            eq(userBooks.userId, userId),
            isNull(userBooks.removedAt),
            searchCondition,
            libraryStateCondition,
            pagination.loanStatus === 'loaned' ? activeLoanCondition : undefined,
            pagination.loanStatus === 'available' ? not(activeLoanCondition) : undefined,
            pagination.readingStatus && pagination.readingStatus !== 'all'
              ? eq(userBooks.readingStatus, pagination.readingStatus)
              : undefined,
            tagCondition,
            normalizedLocation ? sql`lower(coalesce(${locations.path}, '')) like ${`%${normalizedLocation}%`}` : undefined,
            pagination.locationId
              ? pagination.includeLocationDescendants
                ? selectedLocationDescendantPattern
                  ? or(
                      eq(userBooks.locationId, pagination.locationId),
                      sql`${locations.path} like ${selectedLocationDescendantPattern} escape '\\'`
                    )
                  : eq(userBooks.locationId, pagination.locationId)
                : eq(userBooks.locationId, pagination.locationId)
              : undefined
          )

          const firstAuthorSort = sql`(
            select lower(${authors.name})
            from ${bookAuthors}
            inner join ${authors} on ${bookAuthors.authorId} = ${authors.id}
            where ${bookAuthors.bookId} = ${books.id}
            order by ${bookAuthors.sortOrder} asc, lower(${authors.name}) asc
            limit 1
          )`

          const orderBy = pagination.sortBy === 'title'
            ? [asc(sql`lower(${books.title})`), desc(userBooks.addedAt)]
            : pagination.sortBy === 'author'
              ? [asc(sql`coalesce(${firstAuthorSort}, 'zzzzzz')`), asc(sql`lower(${books.title})`), desc(userBooks.addedAt)]
              : pagination.sortBy === 'locationPath'
                ? [asc(sql`coalesce(lower(${locations.path}), 'zzzzzz')`), asc(sql`lower(${books.title})`), desc(userBooks.addedAt)]
                : [desc(userBooks.addedAt)]

          // Get total count
          const countResult = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select({ count: count() })
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .leftJoin(locations, eq(userBooks.locationId, locations.id))
                .where(whereClause),
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
                .leftJoin(locations, eq(userBooks.locationId, locations.id))
                .where(whereClause)
                .orderBy(...orderBy)
                .limit(pageSize)
                .offset(offset),
            catch: error => new DatabaseError({
              message: `Failed to get library items: ${error}`,
              operation: 'getLibrary.items'
            })
          })

          const userBookIds = result.map(row => row.user_books.id)
          const bookIds = result.map(row => row.books.id)
          const userTagsByUserBook = yield* hydrateUserTagsByUserBookIds(userBookIds)
          const authorsByBook = yield* hydrateAuthorsForBookIds(bookIds)
          const activeLoansByUserBook = yield* hydrateActiveLoansByUserBookIds(userBookIds)

          const items = result.map(row => ({
            id: row.user_books.id,
            bookId: row.books.id,
            libraryState: row.user_books.libraryState as LibraryState,
            book: toBookModel(row.books, authorsByBook.get(row.books.id) || []),
            location: toLocationModel(row.locations),
            lastKnownLocation: row.user_books.lastKnownLocation ?? null,
            tags: userTagsByUserBook.get(row.user_books.id) || [],
            addedAt: row.user_books.addedAt,
            activeLoan: activeLoansByUserBook.get(row.user_books.id) ?? null
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

      listTags: userId =>
        Effect.tryPromise({
          try: async () => {
            // Only user-confirmed tags belong in the library's filter list.
            const userTagRows = await dbService.db.select({ id: tags.id, name: tags.name, userBookId: userBooks.id })
              .from(userBooks)
              .innerJoin(userBookTags, eq(userBookTags.userBookId, userBooks.id))
              .innerJoin(tags, eq(tags.id, userBookTags.tagId))
              .where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
              .groupBy(tags.id, tags.name, userBooks.id)
            const tagBooks = new Map<string, { name: string, books: Set<string> }>()
            for (const row of userTagRows) {
              const entry = tagBooks.get(row.id) ?? { name: row.name, books: new Set<string>() }
              entry.books.add(row.userBookId)
              tagBooks.set(row.id, entry)
            }
            return [...tagBooks.entries()]
              .map(([id, entry]) => ({ id, name: entry.name, bookCount: entry.books.size }))
              .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
          },
          catch: error => new DatabaseError({ message: `Failed to list tags: ${error}`, operation: 'listTags' })
        }),

      getLibraryByAuthor: (userId, authorId, pagination) =>
        Effect.gen(function* () {
          const authorRows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({ id: authors.id, name: authors.name })
              .from(authors)
              .where(eq(authors.id, authorId))
              .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to load author: ${error}`,
              operation: 'getLibraryByAuthor.author'
            })
          })

          const author = authorRows[0]
          if (!author) {
            return yield* Effect.fail(new BookNotFoundError({ bookId: authorId }))
          }

          const { page, pageSize } = pagination
          const offset = (page - 1) * pageSize
          const whereClause = and(eq(userBooks.userId, userId), isNull(userBooks.removedAt), eq(bookAuthors.authorId, authorId))

          const countResult = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select({ count: count() })
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
                .where(whereClause),
            catch: error => new DatabaseError({
              message: `Failed to count author library items: ${error}`,
              operation: 'getLibraryByAuthor.count'
            })
          })

          const totalItems = countResult[0]?.count ?? 0
          const totalPages = Math.ceil(totalItems / pageSize)

          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select()
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .innerJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
                .leftJoin(locations, eq(userBooks.locationId, locations.id))
                .where(whereClause)
                .orderBy(desc(userBooks.addedAt))
                .limit(pageSize)
                .offset(offset),
            catch: error => new DatabaseError({
              message: `Failed to get author library items: ${error}`,
              operation: 'getLibraryByAuthor.items'
            })
          })

          const userBookIds = result.map(row => row.user_books.id)
          const bookIds = result.map(row => row.books.id)
          const userTagsByUserBook = yield* hydrateUserTagsByUserBookIds(userBookIds)
          const authorsByBook = yield* hydrateAuthorsForBookIds(bookIds)
          const activeLoansByUserBook = yield* hydrateActiveLoansByUserBookIds(userBookIds)

          const items = result.map(row => ({
            id: row.user_books.id,
            bookId: row.books.id,
            libraryState: row.user_books.libraryState as LibraryState,
            book: toBookModel(row.books, authorsByBook.get(row.books.id) || []),
            location: toLocationModel(row.locations),
            lastKnownLocation: row.user_books.lastKnownLocation ?? null,
            tags: userTagsByUserBook.get(row.user_books.id) || [],
            addedAt: row.user_books.addedAt,
            activeLoan: activeLoansByUserBook.get(row.user_books.id) ?? null
          }))

          return {
            author,
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

          const authorMap = yield* hydrateAuthorsForBookIds([book.id])
          return toBookModel(book, authorMap.get(book.id) || [])
        }),

      listOpenLibraryBooksMissingCovers: limit =>
        Effect.tryPromise({
          try: () =>
            dbService.db
              .select({
                id: books.id,
                isbn: books.isbn
              })
              .from(books)
              .where(and(
                eq(books.source, 'open_library'),
                isNull(books.coverPath),
                sql`${books.isbn} IS NOT NULL`
              ))
              .orderBy(sql`random()`)
              .limit(Math.max(1, limit)),
          catch: error => new DatabaseError({
            message: `Failed to list Open Library books missing covers: ${error}`,
            operation: 'listOpenLibraryBooksMissingCovers'
          })
        }).pipe(
          Effect.map(rows => rows
            .filter((row): row is MissingOpenLibraryCoverBook => typeof row.isbn === 'string' && row.isbn.length > 0)
          )
        ),

      updateOpenLibraryCoverPath: (bookId, coverPath) =>
        Effect.tryPromise({
          try: () =>
            dbService.db
              .update(books)
              .set({ coverPath })
              .where(and(
                eq(books.id, bookId),
                eq(books.source, 'open_library'),
                isNull(books.coverPath)
              ))
              .returning({ id: books.id }),
          catch: error => new DatabaseError({
            message: `Failed to update Open Library cover path: ${error}`,
            operation: 'updateOpenLibraryCoverPath'
          })
        }).pipe(
          Effect.map(rows => rows.length > 0)
        ),

      hasBookInUserLibrary: (userId, isbn) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select({
                  userBookId: userBooks.id,
                  libraryState: userBooks.libraryState
                })
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .where(and(
                  eq(userBooks.userId, userId),
                  eq(books.isbn, isbn),
                  eq(books.source, 'open_library'),
                  isNull(userBooks.removedAt)
                ))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to check user library ownership: ${error}`,
              operation: 'hasBookInUserLibrary'
            })
          })

          const row = result[0]
          return row
            ? { userBookId: row.userBookId, libraryState: row.libraryState as LibraryState }
            : null
        }),

      userOwnsManualCover: (userId, pathname) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select({ id: userBooks.id })
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .where(and(
                  eq(userBooks.userId, userId),
                  isNull(userBooks.removedAt),
                  eq(books.source, 'manual'),
                  eq(books.coverPath, pathname)
                ))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to validate manual cover ownership: ${error}`,
              operation: 'userOwnsManualCover'
            })
          })

          return Boolean(result[0])
        }),

      removeFromLibrary: (userBookId, userId, options = {}) =>
        Effect.gen(function* () {
          yield* getOwnedUserBookRef(userBookId, userId)

          if (!options.confirmActiveLoan) {
            const activeLoan = yield* Effect.tryPromise({
              try: () => dbService.db
                .select({ borrowerDisplayName: loans.borrowerDisplayName })
                .from(loans)
                .where(and(eq(loans.userBookId, userBookId), eq(loans.ownerUserId, userId), eq(loans.status, 'active')))
                .limit(1),
              catch: error => new DatabaseError({
                message: `Failed to check active loan: ${error}`,
                operation: 'removeFromLibrary.checkActiveLoan'
              })
            })

            if (activeLoan[0]) {
              return yield* Effect.fail(new ActiveLoanRemovalError({
                userBookId,
                borrowerDisplayName: activeLoan[0].borrowerDisplayName
              }))
            }
          }

          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .update(userBooks)
                .set({ removedAt: new Date() })
                .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
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
                .where(and(eq(books.isbn, isbn), eq(books.source, 'open_library')))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to find book by ISBN: ${error}`,
              operation: 'findByIsbn'
            })
          })
          const book = result[0]
          if (!book) return null

          const authorMap = yield* hydrateAuthorsForBookIds([book.id])
          return toBookModel(book, authorMap.get(book.id) || [])
        }),

      getSystemTagsByBookId: bookId =>
        Effect.gen(function* () {
          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({
                id: tags.id,
                name: tags.name
              })
              .from(bookSystemTags)
              .innerJoin(tags, eq(bookSystemTags.tagId, tags.id))
              .where(eq(bookSystemTags.bookId, bookId))
              .orderBy(tags.name),
            catch: error => new DatabaseError({
              message: `Failed to get system tags: ${error}`,
              operation: 'getSystemTagsByBookId'
            })
          })

          return rows
        }),

      getUserBookWithDetails: (userBookId, userId) =>
        Effect.gen(function* () {
          const ref = yield* getOwnedUserBookRef(userBookId, userId)

          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select()
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
                .leftJoin(locations, eq(userBooks.locationId, locations.id))
                .where(and(eq(userBooks.id, ref.userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
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

          const userTagRows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({
                id: tags.id,
                name: tags.name
              })
              .from(userBookTags)
              .innerJoin(tags, eq(userBookTags.tagId, tags.id))
              .where(eq(userBookTags.userBookId, ref.userBookId))
              .orderBy(tags.name),
            catch: error => new DatabaseError({
              message: `Failed to load user tags: ${error}`,
              operation: 'getUserBookWithDetails.userTags'
            })
          })

          const userTagIds = userTagRows.map(tag => tag.id)

          const suggestedRows = yield* Effect.tryPromise({
            try: () => {
              if (userTagIds.length === 0) {
                return dbService.db
                  .select({
                    id: tags.id,
                    name: tags.name
                  })
                  .from(bookSystemTags)
                  .innerJoin(tags, eq(bookSystemTags.tagId, tags.id))
                  .where(eq(bookSystemTags.bookId, ref.bookId))
                  .orderBy(tags.name)
              }

              return dbService.db
                .select({
                  id: tags.id,
                  name: tags.name
                })
                .from(bookSystemTags)
                .innerJoin(tags, eq(bookSystemTags.tagId, tags.id))
                .where(and(eq(bookSystemTags.bookId, ref.bookId), notInArray(bookSystemTags.tagId, userTagIds)))
                .orderBy(tags.name)
            },
            catch: error => new DatabaseError({
              message: `Failed to load suggested tags: ${error}`,
              operation: 'getUserBookWithDetails.suggestedTags'
            })
          })

          const bookData = row.books
          const authorsByBook = yield* hydrateAuthorsForBookIds([bookData.id])
          const bookAuthorList = authorsByBook.get(bookData.id) || []
          const activeLoansByUserBook = yield* hydrateActiveLoansByUserBookIds([ref.userBookId])

          return {
            id: row.user_books.id,
            bookId: bookData.id,
            libraryState: row.user_books.libraryState as LibraryState,
            title: bookData.title,
            author: formatAuthorList(bookAuthorList),
            authors: bookAuthorList,
            isbn: bookData.isbn,
            coverPath: bookData.coverPath,
            description: bookData.description ?? null,
            rating: row.user_books.rating ?? null,
            note: row.user_books.note ?? null,
            location: toLocationModel(row.locations),
            lastKnownLocation: row.user_books.lastKnownLocation ?? null,
            readingProgress: {
              status: row.user_books.readingStatus,
              currentPage: row.user_books.currentPage ?? null,
              progressPercent: row.user_books.progressPercent ?? null,
              startedAt: row.user_books.startedAt ?? null,
              finishedAt: row.user_books.finishedAt ?? null
            },
            userTags: userTagRows,
            suggestedTags: suggestedRows,
            publishDate: bookData.publishDate ?? null,
            publishers: bookData.publishers ?? null,
            numberOfPages: bookData.numberOfPages ?? null,
            openLibraryKey: bookData.openLibraryKey,
            workKey: bookData.workKey ?? null,
            addedAt: row.user_books.addedAt,
            activeLoan: activeLoansByUserBook.get(ref.userBookId) ?? null
          }
        }),

      promoteSuggestedTag: (userBookId, userId, tagId) =>
        Effect.gen(function* () {
          const ref = yield* getOwnedUserBookRef(userBookId, userId)

          const exists = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({
                tagId: bookSystemTags.tagId
              })
              .from(bookSystemTags)
              .where(and(eq(bookSystemTags.bookId, ref.bookId), eq(bookSystemTags.tagId, tagId)))
              .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to verify system tag: ${error}`,
              operation: 'promoteSuggestedTag.exists'
            })
          })

          if (!exists[0]) {
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }

          yield* linkUserTag(ref.userBookId, tagId)
        }),

      addUserTag: (userBookId, userId, name) =>
        Effect.gen(function* () {
          const normalized = normalizeTagInput(name)
          if (!normalized) {
            return yield* Effect.fail(new InvalidTagError({ message: 'Tag is empty or invalid' }))
          }

          const ref = yield* getOwnedUserBookRef(userBookId, userId)
          const tagId = yield* resolveOrCreateTagId(normalized)

          yield* linkUserTag(ref.userBookId, tagId)

          const result = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({ id: tags.id, name: tags.name })
              .from(tags)
              .where(eq(tags.id, tagId))
              .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to load created tag: ${error}`,
              operation: 'addUserTag.load'
            })
          })

          const created = result[0]
          if (!created) {
            return yield* Effect.fail(new DatabaseError({
              message: 'Tag created but not found afterwards',
              operation: 'addUserTag.final'
            }))
          }

          return created
        }),

      batchUpdateTags: (userBookId, userId, deleteIds, promoteIds, createNames) =>
        Effect.tryPromise({
          try: async () => {
            const ownedRows = await dbService.db
              .select({
                userBookId: userBooks.id,
                bookId: userBooks.bookId
              })
              .from(userBooks)
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
              .limit(1)

            const owned = ownedRows[0]
            if (!owned) {
              throw new BookNotFoundError({ bookId: userBookId })
            }

            const uniqueDeleteIds = [...new Set(deleteIds)]
            const uniquePromoteIds = [...new Set(promoteIds)]
            const promoteInputs: Array<{ tagId: string, userBookTagId: string }> = []
            const createInputMap = new Map<string, {
              tagId: string
              userBookTagId: string
              displayName: string
              normalizedName: string
              shouldInsertTag: boolean
            }>()

            for (const tagId of uniquePromoteIds) {
              const systemTag = await dbService.db
                .select({ tagId: bookSystemTags.tagId })
                .from(bookSystemTags)
                .where(and(eq(bookSystemTags.bookId, owned.bookId), eq(bookSystemTags.tagId, tagId)))
                .limit(1)

              if (!systemTag[0]) {
                throw new BookNotFoundError({ bookId: userBookId })
              }

              promoteInputs.push({ tagId, userBookTagId: generateId() })
            }

            for (const name of createNames.map(name => name.trim()).filter(Boolean)) {
              const normalized = normalizeTagInput(name)
              if (!normalized) {
                throw new InvalidTagError({ message: 'Tag is empty or invalid' })
              }
              if (createInputMap.has(normalized.key)) {
                continue
              }

              const existing = await dbService.db
                .select({ id: tags.id })
                .from(tags)
                .where(eq(tags.normalizedName, normalized.key))
                .limit(1)
              const existingTagId = existing[0]?.id ?? null

              createInputMap.set(normalized.key, {
                tagId: existingTagId ?? generateId(),
                userBookTagId: generateId(),
                displayName: normalized.displayName,
                normalizedName: normalized.key,
                shouldInsertTag: !existingTagId
              })
            }
            const createInputs = [...createInputMap.values()]

            await dbService.executeAtomic((database) => {
              const statements: AtomicDbStatement[] = []
              const now = new Date()

              for (const tagId of uniqueDeleteIds) {
                statements.push(
                  database
                    .delete(userBookTags)
                    .where(and(eq(userBookTags.userBookId, owned.userBookId), eq(userBookTags.tagId, tagId)))
                )
              }

              for (const promote of promoteInputs) {
                statements.push(
                  database
                    .insert(userBookTags)
                    .values({
                      id: promote.userBookTagId,
                      userBookId: owned.userBookId,
                      tagId: promote.tagId,
                      createdAt: now,
                      updatedAt: now
                    })
                    .onConflictDoNothing()
                )
              }

              for (const input of createInputs) {
                if (input.shouldInsertTag) {
                  // A concurrent creator can win the normalized-name insert between the pre-read and this batch;
                  // the link below resolves the persisted tag by normalized name after the insert attempt.
                  statements.push(
                    database
                      .insert(tags)
                      .values({
                        id: input.tagId,
                        name: input.displayName,
                        normalizedName: input.normalizedName,
                        createdAt: now,
                        updatedAt: now
                      })
                      .onConflictDoNothing()
                  )
                }

                statements.push(
                  database
                    .insert(userBookTags)
                    .values({
                      id: input.userBookTagId,
                      userBookId: owned.userBookId,
                      tagId: sql<string>`(SELECT id FROM tags WHERE normalized_name = ${input.normalizedName})` as unknown as string,
                      createdAt: now,
                      updatedAt: now
                    })
                    .onConflictDoNothing()
                )
              }

              return statements.length > 0
                ? statements as [AtomicDbStatement, ...AtomicDbStatement[]]
                : [database.update(userBooks).set({ id: owned.userBookId }).where(sql`false`)]
            })
          },
          catch: (error) => {
            if (error instanceof BookNotFoundError || error instanceof InvalidTagError || error instanceof DatabaseError) {
              return error
            }

            return new DatabaseError({
              message: `Failed to batch update tags: ${error}`,
              operation: 'batchUpdateTags'
            })
          }
        }),

      deleteTag: (userBookId, userId, tagId) =>
        Effect.gen(function* () {
          const ref = yield* getOwnedUserBookRef(userBookId, userId)

          // Delete the user tag reference
          const deleted = yield* Effect.tryPromise({
            try: () => dbService.db
              .delete(userBookTags)
              .where(and(eq(userBookTags.userBookId, ref.userBookId), eq(userBookTags.tagId, tagId)))
              .returning(),
            catch: error => new DatabaseError({
              message: `Failed to remove tag from user book: ${error}`,
              operation: 'deleteTag.remove'
            })
          })

          if (deleted.length === 0) {
            return yield* Effect.succeed(undefined)
          }

          // Atomically check for any remaining references and delete the tag if none exist
          yield* Effect.tryPromise({
            try: () =>
              dbService.executeAtomic(database => [
                database
                  .delete(tags)
                  .where(
                    and(
                      eq(tags.id, tagId),
                      sql`NOT EXISTS (SELECT 1 FROM ${userBookTags} WHERE ${eq(userBookTags.tagId, tagId)})`,
                      sql`NOT EXISTS (SELECT 1 FROM ${bookSystemTags} WHERE ${eq(bookSystemTags.tagId, tagId)})`
                    )
                  )
              ]),
            catch: error => new DatabaseError({
              message: `Failed to garbage collect tag: ${error}`,
              operation: 'deleteTag.gc'
            })
          })
        }),

      updateRating: (userBookId, userId, rating) =>
        Effect.gen(function* () {
          yield* getOwnedPhysicalUserBookRef(userBookId, userId)

          const result = yield* Effect.tryPromise({
            try: () => dbService.db
              .update(userBooks)
              .set({ rating })
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), eq(userBooks.libraryState, 'owned'), isNull(userBooks.removedAt)))
              .returning({ id: userBooks.id }),
            catch: error => new DatabaseError({
              message: `Failed to update rating: ${error}`,
              operation: 'updateRating'
            })
          })

          if (result.length === 0) {
            yield* getOwnedPhysicalUserBookRef(userBookId, userId)
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }
        }),

      updateNote: (userBookId, userId, note) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () => dbService.db
              .update(userBooks)
              .set({ note })
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
              .returning({ id: userBooks.id }),
            catch: error => new DatabaseError({
              message: `Failed to update note: ${error}`,
              operation: 'updateNote'
            })
          })

          if (result.length === 0) {
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }
        }),

      updateLocation: (userBookId, userId, locationId) =>
        Effect.gen(function* () {
          yield* getOwnedPhysicalUserBookRef(userBookId, userId)

          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .update(userBooks)
                .set({ locationId })
                .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), eq(userBooks.libraryState, 'owned'), isNull(userBooks.removedAt)))
                .returning(),
            catch: error => new DatabaseError({
              message: `Failed to update location: ${error}`,
              operation: 'updateLocation'
            })
          })

          if (result.length === 0) {
            yield* getOwnedPhysicalUserBookRef(userBookId, userId)
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }
        }),

      updateReadingProgress: (userBookId, userId, progress) =>
        Effect.gen(function* () {
          yield* getOwnedPhysicalUserBookRef(userBookId, userId)

          const result = yield* Effect.tryPromise({
            try: () => dbService.db
              .update(userBooks)
              .set({
                readingStatus: progress.status,
                currentPage: progress.currentPage,
                progressPercent: progress.progressPercent,
                startedAt: progress.startedAt ? new Date(progress.startedAt) : null,
                finishedAt: progress.finishedAt ? new Date(progress.finishedAt) : null
              })
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), eq(userBooks.libraryState, 'owned'), isNull(userBooks.removedAt)))
              .returning({ id: userBooks.id }),
            catch: error => new DatabaseError({
              message: `Failed to update reading progress: ${error}`,
              operation: 'updateReadingProgress'
            })
          })

          if (result.length === 0) {
            yield* getOwnedPhysicalUserBookRef(userBookId, userId)
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }
        }),

      updateLibraryState: (userBookId, userId, state) =>
        Effect.gen(function* () {
          yield* getOwnedUserBookRef(userBookId, userId)

          if (state === 'wishlisted' || state === 'previously_owned') {
            const activeLoan = yield* Effect.tryPromise({
              try: () => dbService.db
                .select({ borrowerDisplayName: loans.borrowerDisplayName })
                .from(loans)
                .where(and(eq(loans.userBookId, userBookId), eq(loans.ownerUserId, userId), eq(loans.status, 'active')))
                .limit(1),
              catch: error => new DatabaseError({
                message: `Failed to check active loan before library state update: ${error}`,
                operation: 'updateLibraryState.checkActiveLoan'
              })
            })

            if (activeLoan[0]) {
              return yield* Effect.fail(new ActiveLoanRemovalError({
                userBookId,
                borrowerDisplayName: activeLoan[0].borrowerDisplayName
              }))
            }
          }

          const currentRows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select({
                libraryState: userBooks.libraryState,
                locationPath: locations.path
              })
              .from(userBooks)
              .leftJoin(locations, eq(userBooks.locationId, locations.id))
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
              .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to load current library state: ${error}`,
              operation: 'updateLibraryState.current'
            })
          })
          const current = currentRows[0]
          if (!current) {
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }

          const updated = yield* Effect.tryPromise({
            try: () => dbService.db
              .update(userBooks)
              .set(
                state === 'wishlisted'
                  ? {
                      libraryState: state,
                      locationId: null,
                      lastKnownLocation: null,
                      rating: null,
                      readingStatus: 'unread',
                      currentPage: null,
                      progressPercent: null,
                      startedAt: null,
                      finishedAt: null
                    }
                  : state === 'previously_owned'
                    ? {
                        libraryState: state,
                        locationId: null,
                        lastKnownLocation: current.locationPath ?? null
                      }
                    : {
                        libraryState: state,
                        lastKnownLocation: null
                      }
              )
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
              .returning({ id: userBooks.id }),
            catch: error => new DatabaseError({
              message: `Failed to update library state: ${error}`,
              operation: 'updateLibraryState'
            })
          })

          if (updated.length === 0) {
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }

          const rows = yield* Effect.tryPromise({
            try: () => dbService.db
              .select()
              .from(userBooks)
              .innerJoin(books, eq(userBooks.bookId, books.id))
              .leftJoin(locations, eq(userBooks.locationId, locations.id))
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
              .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to load updated library state: ${error}`,
              operation: 'updateLibraryState.load'
            })
          })

          const row = rows[0]
          if (!row) {
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }

          const authorMap = yield* hydrateAuthorsForBookIds([row.books.id])
          const tagMap = yield* hydrateUserTagsByUserBookIds([userBookId])
          const activeLoansByUserBook = yield* hydrateActiveLoansByUserBookIds([userBookId])

          return {
            id: row.user_books.id,
            bookId: row.books.id,
            libraryState: row.user_books.libraryState as LibraryState,
            book: toBookModel(row.books, authorMap.get(row.books.id) || []),
            location: toLocationModel(row.locations),
            lastKnownLocation: row.user_books.lastKnownLocation ?? null,
            tags: tagMap.get(userBookId) || [],
            addedAt: row.user_books.addedAt,
            activeLoan: activeLoansByUserBook.get(userBookId) ?? null
          }
        })
    }
  })
)

// Helper effects
export const ensureOpenLibraryBook = (isbn: string) =>
  Effect.flatMap(BookRepository, repo => repo.ensureOpenLibraryBook(isbn))

export const addBookByISBN = (userId: string, isbn: string, libraryState?: LibraryState) =>
  Effect.flatMap(BookRepository, repo => repo.addBookByISBN(userId, isbn, libraryState))

export const createManualBookRecord = (userId: string, input: ManualBookRepositoryInput) =>
  Effect.flatMap(BookRepository, repo => repo.createManualBook(userId, input))

export const getLibrary = (userId: string, pagination: PaginationParams & LibraryQueryFilters) =>
  Effect.flatMap(BookRepository, repo => repo.getLibrary(userId, pagination))

export const getLibraryByAuthor = (userId: string, authorId: string, pagination: PaginationParams) =>
  Effect.flatMap(BookRepository, repo => repo.getLibraryByAuthor(userId, authorId, pagination))

export const getBookById = (bookId: string) =>
  Effect.flatMap(BookRepository, repo => repo.getBookById(bookId))

export const listOpenLibraryBooksMissingCovers = (limit: number) =>
  Effect.flatMap(BookRepository, repo => repo.listOpenLibraryBooksMissingCovers(limit))

export const updateOpenLibraryCoverPath = (bookId: string, coverPath: string) =>
  Effect.flatMap(BookRepository, repo => repo.updateOpenLibraryCoverPath(bookId, coverPath))

export const userOwnsManualCover = (userId: string, pathname: string) =>
  Effect.flatMap(BookRepository, repo => repo.userOwnsManualCover(userId, pathname))

export const removeFromLibrary = (
  userBookId: string,
  userId: string,
  options?: { confirmActiveLoan?: boolean }
) =>
  Effect.flatMap(BookRepository, repo => repo.removeFromLibrary(userBookId, userId, options))

export const findByIsbn = (isbn: string) =>
  Effect.flatMap(BookRepository, repo => repo.findByIsbn(isbn))

export const getSystemTagsByBookId = (bookId: string) =>
  Effect.flatMap(BookRepository, repo => repo.getSystemTagsByBookId(bookId))

export const getUserBookWithDetails = (userBookId: string, userId: string) =>
  Effect.flatMap(BookRepository, repo => repo.getUserBookWithDetails(userBookId, userId))
