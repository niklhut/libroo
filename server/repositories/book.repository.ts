import { Context, Effect, Layer, Data } from 'effect'
import type { HttpClient } from '@effect/platform'
import { eq, and, count, desc, asc, inArray, or, sql, notInArray, exists, isNull, not } from 'drizzle-orm'
import { books, authors, bookAuthors, userBooks, tags, bookSystemTags, userBookTags, loans, user, locations } from 'hub:db:schema'
import { normalizeTagInput, normalizeSuggestedTags } from '../../shared/utils/tag-ingestion'
import type { LibraryQueryFilters } from '../../shared/utils/library-query'

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
  book: Book
  location: BookLocation | null
  tags: string[]
  addedAt: Date
  activeLoan: ActiveLoanSummary | null
}

export interface BookTagRecord {
  id: string
  name: string
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
  currentPage: number | null
  progressPercent: number | null
  tags: string[]
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

  createManualBook: (
    userId: string,
    input: ManualBookRepositoryInput
  ) => Effect.Effect<UserBook, BookCreateError | DatabaseError, DbService>

  getLibrary: (
    userId: string,
    pagination: PaginationParams & LibraryQueryFilters
  ) => Effect.Effect<PaginatedResult<UserBook>, DatabaseError, DbService>

  getLibraryByAuthor: (
    userId: string,
    authorId: string,
    pagination: PaginationParams
  ) => Effect.Effect<AuthorLibraryResult, BookNotFoundError | DatabaseError, DbService>

  getBookById: (bookId: string) => Effect.Effect<Book, BookNotFoundError | DatabaseError, DbService>

  hasBookInUserLibrary: (
    userId: string,
    isbn: string
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
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>

  updateNote: (
    userBookId: string,
    userId: string,
    note: string | null
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>

  updateLocation: (
    userBookId: string,
    userId: string,
    locationId: string | null
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>

  updateReadingProgress: (
    userBookId: string,
    userId: string,
    progress: ReadingProgress
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>
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
                .where(and(
                  eq(userBooks.userId, userId),
                  eq(books.isbn, isbn),
                  eq(books.source, 'open_library'),
                  isNull(userBooks.removedAt)
                ))
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
                .where(and(eq(books.isbn, isbn), eq(books.source, 'open_library')))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to find existing book: ${error}`,
              operation: 'addBookByISBN.findExisting'
            })
          })

          let book = bookResult[0] || null
          let openLibraryData

          // If book doesn't exist, fetch from OpenLibrary and create it
          if (!book) {
            openLibraryData = yield* lookupByISBN(isbn)

            // Download cover to local storage
            const coverPath = yield* downloadCover(isbn, 'L')

            const newBookId = generateId()
            const now = new Date()

            const newBook = {
              id: newBookId,
              isbn: openLibraryData.isbn,
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

            yield* Effect.tryPromise({
              try: () => dbService.db.insert(books).values(newBook),
              catch: error => new BookCreateError({ message: `Failed to insert book: ${error}` })
            })

            yield* setBookAuthors(newBookId, openLibraryData.authors)

            // Hydrate system tags for newly-inserted book
            yield* hydrateSystemTagsForBook(newBookId, openLibraryData.subjects || [])

            book = newBook
          } else {
            // Reusing existing book: fetch OpenLibrary data to ensure system tags are hydrated
            openLibraryData = yield* lookupByISBN(isbn)
            // Idempotently hydrate system tags for the existing book (safe if already linked via onConflictDoNothing)
            yield* hydrateSystemTagsForBook(book.id, openLibraryData.subjects || [])
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

          const authorMap = yield* hydrateAuthorsForBookIds([book.id])
          const hydratedBook = toBookModel(book, authorMap.get(book.id) || [])

          return {
            id: userBookId,
            bookId: book.id,
            book: hydratedBook,
            location: null,
            tags: [],
            addedAt,
            activeLoan: null
          }
        }),

      createManualBook: (userId, input) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: async () => {
              return dbService.db.transaction(async (tx) => {
                const now = new Date()
                const bookId = generateId()
                const newBook = {
                  id: bookId,
                  isbn: input.isbn,
                  title: input.title,
                  coverPath: input.coverPath,
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

                await tx.insert(books).values(newBook)

                const normalizedSeen = new Set<string>()
                const manualAuthorNames = input.authors.filter((name) => {
                  const normalized = normalizeAuthorName(name)
                  if (!normalized || normalizedSeen.has(normalized)) return false
                  normalizedSeen.add(normalized)
                  return true
                })
                const authorNames = manualAuthorNames.length > 0 ? manualAuthorNames : ['Unknown Author']

                for (const [index, authorName] of authorNames.entries()) {
                  const authorId = await (async () => {
                    const displayName = authorName.trim().replace(/\s+/g, ' ')
                    const normalizedName = normalizeAuthorName(displayName)
                    const existing = await tx
                      .select({ id: authors.id })
                      .from(authors)
                      .where(eq(authors.normalizedName, normalizedName))
                      .limit(1)

                    if (existing[0]) return existing[0].id

                    const newAuthorId = generateId()
                    await tx
                      .insert(authors)
                      .values({
                        id: newAuthorId,
                        name: displayName,
                        normalizedName,
                        createdAt: now,
                        updatedAt: now
                      })
                      .onConflictDoNothing()

                    const found = await tx
                      .select({ id: authors.id })
                      .from(authors)
                      .where(eq(authors.normalizedName, normalizedName))
                      .limit(1)

                    const foundAuthor = found[0]
                    if (!foundAuthor) {
                      throw new DatabaseError({
                        message: `Author upsert failed for name: ${displayName}`,
                        operation: 'createManualBook.author'
                      })
                    }

                    return foundAuthor.id
                  })()

                  await tx
                    .insert(bookAuthors)
                    .values({
                      bookId,
                      authorId,
                      sortOrder: index,
                      createdAt: now
                    })
                    .onConflictDoNothing()
                }

                const userBookId = generateId()
                await tx.insert(userBooks).values({
                  id: userBookId,
                  userId,
                  bookId,
                  rating: input.rating,
                  note: input.note,
                  readingStatus: input.readingStatus,
                  currentPage: input.currentPage,
                  progressPercent: input.progressPercent,
                  addedAt: now
                })

                const uniqueTagNames = [...new Set(input.tags.map(tag => tag.trim()).filter(Boolean))]

                for (const tagName of uniqueTagNames) {
                  const normalized = normalizeTagInput(tagName)
                  if (!normalized) continue

                  const existing = await tx
                    .select({ id: tags.id })
                    .from(tags)
                    .where(eq(tags.normalizedName, normalized.key))
                    .limit(1)

                  let tagId = existing[0]?.id ?? null

                  if (!tagId) {
                    const newTagId = generateId()
                    await tx
                      .insert(tags)
                      .values({
                        id: newTagId,
                        name: normalized.displayName,
                        normalizedName: normalized.key,
                        createdAt: now,
                        updatedAt: now
                      })
                      .onConflictDoNothing()

                    const found = await tx
                      .select({ id: tags.id })
                      .from(tags)
                      .where(eq(tags.normalizedName, normalized.key))
                      .limit(1)

                    tagId = found[0]?.id ?? null
                  }

                  if (!tagId) {
                    throw new DatabaseError({
                      message: `Tag upsert failed for key: ${normalized.key}`,
                      operation: 'createManualBook.tag'
                    })
                  }

                  await tx
                    .insert(userBookTags)
                    .values({
                      id: generateId(),
                      userBookId,
                      tagId,
                      createdAt: now,
                      updatedAt: now
                    })
                    .onConflictDoNothing()
                }

                const createdRows = await tx
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

                const authorRows = await tx
                  .select({
                    id: authors.id,
                    name: authors.name
                  })
                  .from(bookAuthors)
                  .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
                  .where(eq(bookAuthors.bookId, bookId))
                  .orderBy(asc(bookAuthors.sortOrder), asc(authors.name))

                const userTagRows = await tx
                  .select({ name: tags.name })
                  .from(userBookTags)
                  .innerJoin(tags, eq(userBookTags.tagId, tags.id))
                  .where(eq(userBookTags.userBookId, userBookId))

                return {
                  id: userBookId,
                  bookId,
                  book: toBookModel(createdBook, authorRows),
                  location: null,
                  tags: userTagRows.map(tag => tag.name),
                  addedAt: now,
                  activeLoan: null
                }
              })
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
          const normalizedTag = pagination.tag?.trim().toLowerCase()
          const normalizedLocation = pagination.location?.trim().toLowerCase()
          const activeLoanCondition = exists(
            dbService.db
              .select({ value: sql`1` })
              .from(loans)
              .where(and(eq(loans.userBookId, userBooks.id), eq(loans.status, 'active')))
          )
          const tagCondition = normalizedTag
            ? or(
                exists(
                  dbService.db
                    .select({ value: sql`1` })
                    .from(userBookTags)
                    .innerJoin(tags, eq(userBookTags.tagId, tags.id))
                    .where(and(eq(userBookTags.userBookId, userBooks.id), sql`lower(${tags.name}) like ${`%${normalizedTag}%`}`))
                ),
                exists(
                  dbService.db
                    .select({ value: sql`1` })
                    .from(bookSystemTags)
                    .innerJoin(tags, eq(bookSystemTags.tagId, tags.id))
                    .where(and(eq(bookSystemTags.bookId, books.id), sql`lower(${tags.name}) like ${`%${normalizedTag}%`}`))
                )
              )
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

          const whereClause = and(
            eq(userBooks.userId, userId),
            isNull(userBooks.removedAt),
            searchCondition,
            pagination.loanStatus === 'loaned' ? activeLoanCondition : undefined,
            pagination.loanStatus === 'available' ? not(activeLoanCondition) : undefined,
            pagination.readingStatus && pagination.readingStatus !== 'all'
              ? eq(userBooks.readingStatus, pagination.readingStatus)
              : undefined,
            tagCondition,
            normalizedLocation ? sql`lower(coalesce(${locations.path}, '')) like ${`%${normalizedLocation}%`}` : undefined
          )

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
                .orderBy(desc(userBooks.addedAt))
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
            book: toBookModel(row.books, authorsByBook.get(row.books.id) || []),
            location: toLocationModel(row.locations),
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
            book: toBookModel(row.books, authorsByBook.get(row.books.id) || []),
            location: toLocationModel(row.locations),
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

      hasBookInUserLibrary: (userId, isbn) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select({ id: userBooks.id })
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
            title: bookData.title,
            author: formatAuthorList(bookAuthorList),
            authors: bookAuthorList,
            isbn: bookData.isbn,
            coverPath: bookData.coverPath,
            description: bookData.description ?? null,
            rating: row.user_books.rating ?? null,
            note: row.user_books.note ?? null,
            location: toLocationModel(row.locations),
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
            await dbService.db.transaction(async (tx) => {
              const ownedRows = await tx
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
              const uniqueCreateNames = [...new Set(createNames.map(name => name.trim()).filter(Boolean))]

              for (const tagId of uniqueDeleteIds) {
                await tx
                  .delete(userBookTags)
                  .where(and(eq(userBookTags.userBookId, owned.userBookId), eq(userBookTags.tagId, tagId)))
              }

              for (const tagId of uniquePromoteIds) {
                const systemTag = await tx
                  .select({ tagId: bookSystemTags.tagId })
                  .from(bookSystemTags)
                  .where(and(eq(bookSystemTags.bookId, owned.bookId), eq(bookSystemTags.tagId, tagId)))
                  .limit(1)

                if (!systemTag[0]) {
                  throw new BookNotFoundError({ bookId: userBookId })
                }

                await tx
                  .insert(userBookTags)
                  .values({
                    id: generateId(),
                    userBookId: owned.userBookId,
                    tagId,
                    createdAt: new Date(),
                    updatedAt: new Date()
                  })
                  .onConflictDoNothing()
              }

              for (const name of uniqueCreateNames) {
                const normalized = normalizeTagInput(name)
                if (!normalized) {
                  throw new InvalidTagError({ message: 'Tag is empty or invalid' })
                }

                const existing = await tx
                  .select({ id: tags.id })
                  .from(tags)
                  .where(eq(tags.normalizedName, normalized.key))
                  .limit(1)

                let tagId = existing[0]?.id ?? null

                if (!tagId) {
                  const newTagId = generateId()

                  await tx
                    .insert(tags)
                    .values({
                      id: newTagId,
                      name: normalized.displayName,
                      normalizedName: normalized.key,
                      createdAt: new Date(),
                      updatedAt: new Date()
                    })
                    .onConflictDoNothing()

                  const found = await tx
                    .select({ id: tags.id })
                    .from(tags)
                    .where(eq(tags.normalizedName, normalized.key))
                    .limit(1)

                  tagId = found[0]?.id ?? null
                }

                if (!tagId) {
                  throw new DatabaseError({
                    message: `Tag upsert failed for key: ${normalized.key}`,
                    operation: 'batchUpdateTags.create'
                  })
                }

                await tx
                  .insert(userBookTags)
                  .values({
                    id: generateId(),
                    userBookId: owned.userBookId,
                    tagId,
                    createdAt: new Date(),
                    updatedAt: new Date()
                  })
                  .onConflictDoNothing()
              }
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
              dbService.db.transaction(async (tx) => {
                // Delete tag only if no references exist in either table (atomic operation)
                await tx
                  .delete(tags)
                  .where(
                    and(
                      eq(tags.id, tagId),
                      sql`NOT EXISTS (SELECT 1 FROM ${userBookTags} WHERE ${eq(userBookTags.tagId, tagId)})`,
                      sql`NOT EXISTS (SELECT 1 FROM ${bookSystemTags} WHERE ${eq(bookSystemTags.tagId, tagId)})`
                    )
                  )
              }),
            catch: error => new DatabaseError({
              message: `Failed to garbage collect tag: ${error}`,
              operation: 'deleteTag.gc'
            })
          })
        }),

      updateRating: (userBookId, userId, rating) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () => dbService.db
              .update(userBooks)
              .set({ rating })
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
              .returning({ id: userBooks.id }),
            catch: error => new DatabaseError({
              message: `Failed to update rating: ${error}`,
              operation: 'updateRating'
            })
          })

          if (result.length === 0) {
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
          yield* getOwnedUserBookRef(userBookId, userId)

          const result = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .update(userBooks)
                .set({ locationId })
                .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
                .returning(),
            catch: error => new DatabaseError({
              message: `Failed to update location: ${error}`,
              operation: 'updateLocation'
            })
          })

          if (result.length === 0) {
            return yield* Effect.fail(new BookNotFoundError({ bookId: userBookId }))
          }
        }),

      updateReadingProgress: (userBookId, userId, progress) =>
        Effect.gen(function* () {
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
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
              .returning({ id: userBooks.id }),
            catch: error => new DatabaseError({
              message: `Failed to update reading progress: ${error}`,
              operation: 'updateReadingProgress'
            })
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
  Effect.flatMap(BookRepository, repo => repo.addBookByISBN(userId, isbn))

export const createManualBookRecord = (userId: string, input: ManualBookRepositoryInput) =>
  Effect.flatMap(BookRepository, repo => repo.createManualBook(userId, input))

export const getLibrary = (userId: string, pagination: PaginationParams & { search?: string }) =>
  Effect.flatMap(BookRepository, repo => repo.getLibrary(userId, pagination))

export const getLibraryByAuthor = (userId: string, authorId: string, pagination: PaginationParams) =>
  Effect.flatMap(BookRepository, repo => repo.getLibraryByAuthor(userId, authorId, pagination))

export const getBookById = (bookId: string) =>
  Effect.flatMap(BookRepository, repo => repo.getBookById(bookId))

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
