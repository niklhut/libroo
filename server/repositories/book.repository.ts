import { Context, Effect, Layer, Data } from 'effect'
import type { HttpClient } from '@effect/platform'
import { eq, and, count, desc, asc, inArray, or, sql, notInArray, exists } from 'drizzle-orm'
import { books, authors, bookAuthors, userBooks, tags, bookSystemTags, userBookTags } from 'hub:db:schema'
import { normalizeTagInput, normalizeSuggestedTags } from '../../shared/utils/tag-ingestion'

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
}

export interface UserBook {
  id: string
  bookId: string
  book: Book
  tags: string[]
  addedAt: Date
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
    pagination: PaginationParams & { search?: string }
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
    userId: string
  ) => Effect.Effect<void, BookNotFoundError | DatabaseError, DbService>

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
      workKey: book.workKey
    })

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
            .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId)))
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
            tags: [],
            addedAt
          }
        }),

      getLibrary: (userId, pagination) =>
        Effect.gen(function* () {
          const { page, pageSize } = pagination
          const offset = (page - 1) * pageSize
          const normalizedSearch = pagination.search?.trim().toLowerCase()
          const hasSearch = Boolean(normalizedSearch)
          const likePattern = `%${normalizedSearch}%`

          const searchCondition = hasSearch
            ? or(
                sql`lower(${books.title}) like ${likePattern}`,
                sql`lower(coalesce(${books.isbn}, '')) like ${likePattern}`,
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

          const whereClause = hasSearch
            ? and(eq(userBooks.userId, userId), searchCondition)
            : eq(userBooks.userId, userId)

          // Get total count
          const countResult = yield* Effect.tryPromise({
            try: () =>
              dbService.db
                .select({ count: count() })
                .from(userBooks)
                .innerJoin(books, eq(userBooks.bookId, books.id))
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

          const items = result.map(row => ({
            id: row.user_books.id,
            bookId: row.books.id,
            book: toBookModel(row.books, authorsByBook.get(row.books.id) || []),
            tags: userTagsByUserBook.get(row.user_books.id) || [],
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
          const whereClause = and(eq(userBooks.userId, userId), eq(bookAuthors.authorId, authorId))

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

          const items = result.map(row => ({
            id: row.user_books.id,
            bookId: row.books.id,
            book: toBookModel(row.books, authorsByBook.get(row.books.id) || []),
            tags: userTagsByUserBook.get(row.user_books.id) || [],
            addedAt: row.user_books.addedAt
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
                .where(and(eq(userBooks.userId, userId), eq(books.isbn, isbn)))
                .limit(1),
            catch: error => new DatabaseError({
              message: `Failed to check user library ownership: ${error}`,
              operation: 'hasBookInUserLibrary'
            })
          })

          return Boolean(result[0])
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
                .where(and(eq(userBooks.id, ref.userBookId), eq(userBooks.userId, userId)))
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
            addedAt: row.user_books.addedAt
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
                .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId)))
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
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId)))
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
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId)))
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
              .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId)))
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

export const getLibrary = (userId: string, pagination: PaginationParams & { search?: string }) =>
  Effect.flatMap(BookRepository, repo => repo.getLibrary(userId, pagination))

export const getLibraryByAuthor = (userId: string, authorId: string, pagination: PaginationParams) =>
  Effect.flatMap(BookRepository, repo => repo.getLibraryByAuthor(userId, authorId, pagination))

export const getBookById = (bookId: string) =>
  Effect.flatMap(BookRepository, repo => repo.getBookById(bookId))

export const removeFromLibrary = (userBookId: string, userId: string) =>
  Effect.flatMap(BookRepository, repo => repo.removeFromLibrary(userBookId, userId))

export const findByIsbn = (isbn: string) =>
  Effect.flatMap(BookRepository, repo => repo.findByIsbn(isbn))

export const getSystemTagsByBookId = (bookId: string) =>
  Effect.flatMap(BookRepository, repo => repo.getSystemTagsByBookId(bookId))

export const getUserBookWithDetails = (userBookId: string, userId: string) =>
  Effect.flatMap(BookRepository, repo => repo.getUserBookWithDetails(userBookId, userId))
