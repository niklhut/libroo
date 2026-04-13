import { Context, Effect, Layer, Data } from 'effect'
import type { HttpClient } from '@effect/platform'
import { eq, and, count, desc, inArray, or, sql, notInArray, exists } from 'drizzle-orm'
import type { InferSelectModel } from 'drizzle-orm'
import { books, userBooks, tags, bookSystemTags, userBookTags } from 'hub:db:schema'
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
  ) => Effect.Effect<InferSelectModel<typeof books> | null, DatabaseError, DbService>

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
              author: openLibraryData.authors.join(', '),
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
                sql`lower(${books.author}) like ${likePattern}`,
                sql`lower(coalesce(${books.isbn}, '')) like ${likePattern}`,
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
          const userTagsByUserBook = yield* hydrateUserTagsByUserBookIds(userBookIds)

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
          return result[0] || null
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

          return {
            id: row.user_books.id,
            bookId: bookData.id,
            title: bookData.title,
            author: bookData.author,
            isbn: bookData.isbn,
            coverPath: bookData.coverPath,
            description: bookData.description ?? null,
            rating: row.user_books.rating ?? null,
            note: row.user_books.note ?? null,
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
          const ref = yield* getOwnedUserBookRef(userBookId, userId)

          yield* Effect.tryPromise({
            try: () => dbService.db
              .update(userBooks)
              .set({ rating })
              .where(eq(userBooks.id, ref.userBookId)),
            catch: error => new DatabaseError({
              message: `Failed to update rating: ${error}`,
              operation: 'updateRating'
            })
          })
        }),

      updateNote: (userBookId, userId, note) =>
        Effect.gen(function* () {
          const ref = yield* getOwnedUserBookRef(userBookId, userId)

          yield* Effect.tryPromise({
            try: () => dbService.db
              .update(userBooks)
              .set({ note })
              .where(eq(userBooks.id, ref.userBookId)),
            catch: error => new DatabaseError({
              message: `Failed to update note: ${error}`,
              operation: 'updateNote'
            })
          })
        })
    }
  })
)

// Helper effects
export const addBookByISBN = (userId: string, isbn: string) =>
  Effect.flatMap(BookRepository, repo => repo.addBookByISBN(userId, isbn))

export const getLibrary = (userId: string, pagination: PaginationParams & { search?: string }) =>
  Effect.flatMap(BookRepository, repo => repo.getLibrary(userId, pagination))

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
