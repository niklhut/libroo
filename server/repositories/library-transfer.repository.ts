import { Context, Effect, Layer } from 'effect'
import { asc, and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { authors, bookAuthors, books, locations, loans, tags, userBooks, userBookTags } from 'hub:db:schema'
import { normalizeBookLocationKey, normalizeBookLocationName } from '../../shared/utils/book-location'
import { locationChildPath } from '../../shared/utils/location-hierarchy'
import { normalizeTagInput } from '../../shared/utils/tag-ingestion'
import type {
  LibraryExportRecord,
  LibraryImportBookInput,
  LibraryImportConflictStrategy,
  LibraryImportResult
} from '../../shared/types/library-transfer'

interface ExistingImportMatch {
  userBookId: string
  bookId: string
  bookSource: 'open_library' | 'manual'
  createdByUserId: string | null
}

export interface LibraryTransferRepositoryInterface {
  listExportRecords: (userId: string) => Effect.Effect<LibraryExportRecord[], DatabaseError, DbService>
  importRecords: (
    userId: string,
    records: LibraryImportBookInput[],
    conflictStrategy: LibraryImportConflictStrategy
  ) => Effect.Effect<LibraryImportResult, DatabaseError, DbService>
}

export class LibraryTransferRepository extends Context.Tag('LibraryTransferRepository')<
  LibraryTransferRepository,
  LibraryTransferRepositoryInterface
>() { }

function generateId(): string {
  return crypto.randomUUID()
}

function normalizeAuthorName(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

function normalizeConflictText(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function splitLocationPath(path: string) {
  return path.split(/\s+-\s+/).flatMap((part) => {
    const name = normalizeBookLocationName(part)
    return name ? [name] : []
  })
}

export const LibraryTransferRepositoryLive = Layer.effect(
  LibraryTransferRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService

    return {
      listExportRecords: userId =>
        Effect.tryPromise({
          try: async () => {
            const rows = await dbService.db
              .select({
                userBookId: userBooks.id,
                bookId: books.id,
                title: books.title,
                isbn: books.isbn,
                source: books.source,
                locationPath: locations.path,
                readingStatus: userBooks.readingStatus,
                currentPage: userBooks.currentPage,
                progressPercent: userBooks.progressPercent,
                rating: userBooks.rating,
                note: userBooks.note,
                addedAt: userBooks.addedAt,
                activeLoanBorrower: loans.borrowerDisplayName,
                activeLoanLoanedAt: loans.loanedAt,
                activeLoanDueAt: loans.dueAt
              })
              .from(userBooks)
              .innerJoin(books, eq(userBooks.bookId, books.id))
              .leftJoin(locations, eq(userBooks.locationId, locations.id))
              .leftJoin(loans, and(
                eq(loans.userBookId, userBooks.id),
                eq(loans.ownerUserId, userId),
                eq(loans.status, 'active')
              ))
              .where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
              .orderBy(asc(books.title), asc(userBooks.addedAt))

            const bookIds = [...new Set(rows.map(row => row.bookId))]
            const userBookIds = rows.map(row => row.userBookId)
            const authorRows = bookIds.length === 0
              ? []
              : await dbService.db
                  .select({
                    bookId: bookAuthors.bookId,
                    name: authors.name
                  })
                  .from(bookAuthors)
                  .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
                  .where(inArray(bookAuthors.bookId, bookIds))
                  .orderBy(asc(bookAuthors.sortOrder), asc(authors.name))
            const tagRows = userBookIds.length === 0
              ? []
              : await dbService.db
                  .select({
                    userBookId: userBookTags.userBookId,
                    name: tags.name
                  })
                  .from(userBookTags)
                  .innerJoin(tags, eq(userBookTags.tagId, tags.id))
                  .where(inArray(userBookTags.userBookId, userBookIds))
                  .orderBy(asc(tags.name))

            const authorsByBook = new Map<string, string[]>()
            for (const row of authorRows) {
              const list = authorsByBook.get(row.bookId) ?? []
              list.push(row.name)
              authorsByBook.set(row.bookId, list)
            }

            const tagsByUserBook = new Map<string, string[]>()
            for (const row of tagRows) {
              const list = tagsByUserBook.get(row.userBookId) ?? []
              list.push(row.name)
              tagsByUserBook.set(row.userBookId, list)
            }

            return rows.map(row => ({
              title: row.title,
              authors: authorsByBook.get(row.bookId) ?? ['Unknown Author'],
              isbn: row.isbn ?? null,
              tags: tagsByUserBook.get(row.userBookId) ?? [],
              location: row.locationPath ?? null,
              readingStatus: row.readingStatus,
              currentPage: row.currentPage ?? null,
              progressPercent: row.progressPercent ?? null,
              rating: row.rating ?? null,
              note: row.note ?? null,
              addedAt: row.addedAt,
              source: row.source,
              activeLoan: row.activeLoanBorrower && row.activeLoanLoanedAt
                ? {
                    status: 'loaned' as const,
                    borrowerDisplayName: row.activeLoanBorrower,
                    loanedAt: row.activeLoanLoanedAt,
                    dueAt: row.activeLoanDueAt ?? null
                  }
                : null
            }))
          },
          catch: error => new DatabaseError({
            message: `Failed to export library: ${error}`,
            operation: 'libraryTransfer.listExportRecords'
          })
        }),

      importRecords: (userId, records, conflictStrategy) =>
        Effect.tryPromise({
          try: async () => {
            const result: LibraryImportResult = { created: 0, updated: 0, skipped: 0, failed: [] }

            await dbService.db.transaction(async (tx) => {
              const resolveAuthorId = async (name: string, now: Date) => {
                const displayName = name.trim().replace(/\s+/g, ' ') || 'Unknown Author'
                const normalizedName = normalizeAuthorName(displayName)
                const existing = await tx.select({ id: authors.id }).from(authors).where(eq(authors.normalizedName, normalizedName)).limit(1)
                if (existing[0]) return existing[0].id

                const id = generateId()
                await tx.insert(authors).values({ id, name: displayName, normalizedName, createdAt: now, updatedAt: now }).onConflictDoNothing()
                const resolved = await tx.select({ id: authors.id }).from(authors).where(eq(authors.normalizedName, normalizedName)).limit(1)
                return resolved[0]?.id ?? id
              }

              const resolveTagId = async (name: string, now: Date) => {
                const normalized = normalizeTagInput(name)
                if (!normalized) return null

                const existing = await tx.select({ id: tags.id }).from(tags).where(eq(tags.normalizedName, normalized.key)).limit(1)
                if (existing[0]) return existing[0].id

                const id = generateId()
                await tx.insert(tags).values({
                  id,
                  name: normalized.displayName,
                  normalizedName: normalized.key,
                  createdAt: now,
                  updatedAt: now
                }).onConflictDoNothing()
                const resolved = await tx.select({ id: tags.id }).from(tags).where(eq(tags.normalizedName, normalized.key)).limit(1)
                return resolved[0]?.id ?? id
              }

              const setAuthors = async (bookId: string, names: string[], now: Date) => {
                await tx.delete(bookAuthors).where(eq(bookAuthors.bookId, bookId))
                const seen = new Set<string>()
                const uniqueNames = names.filter((name) => {
                  const key = normalizeAuthorName(name)
                  if (!key || seen.has(key)) return false
                  seen.add(key)
                  return true
                })
                const authorNames = uniqueNames.length > 0 ? uniqueNames : ['Unknown Author']
                for (const [index, name] of authorNames.entries()) {
                  const authorId = await resolveAuthorId(name, now)
                  await tx.insert(bookAuthors).values({ bookId, authorId, sortOrder: index, createdAt: now }).onConflictDoNothing()
                }
              }

              const setTags = async (userBookId: string, tagNames: string[], now: Date) => {
                await tx.delete(userBookTags).where(eq(userBookTags.userBookId, userBookId))
                const seen = new Set<string>()
                for (const name of tagNames) {
                  const normalized = normalizeTagInput(name)
                  if (!normalized || seen.has(normalized.key)) continue
                  seen.add(normalized.key)
                  const tagId = await resolveTagId(normalized.displayName, now)
                  if (!tagId) continue
                  await tx.insert(userBookTags).values({
                    id: generateId(),
                    userBookId,
                    tagId,
                    createdAt: now,
                    updatedAt: now
                  }).onConflictDoNothing()
                }
              }

              const resolveLocationId = async (path: string | null, now: Date) => {
                if (!path) return null

                const parts = splitLocationPath(path)
                if (parts.length === 0) return null

                let parent: { id: string, name: string, parentLocationId: string | null, path: string, depth: number } | null = null
                for (const part of parts) {
                  const normalizedName = normalizeBookLocationKey(part)
                  const existing = await tx
                    .select({
                      id: locations.id,
                      name: locations.name,
                      parentLocationId: locations.parentLocationId,
                      path: locations.path,
                      depth: locations.depth
                    })
                    .from(locations)
                    .where(and(
                      eq(locations.userId, userId),
                      parent ? eq(locations.parentLocationId, parent.id) : isNull(locations.parentLocationId),
                      eq(locations.normalizedName, normalizedName)
                    ))
                    .limit(1)

                  if (existing[0]) {
                    parent = existing[0]
                    continue
                  }

                  const id = generateId()
                  const locationPath = locationChildPath(parent, part)
                  const depth: number = parent ? parent.depth + 1 : 0
                  await tx.insert(locations).values({
                    id,
                    userId,
                    parentLocationId: parent?.id ?? null,
                    name: part,
                    normalizedName,
                    path: locationPath,
                    depth,
                    createdAt: now,
                    updatedAt: now
                  })
                  parent = { id, name: part, parentLocationId: parent?.id ?? null, path: locationPath, depth }
                }

                return parent?.id ?? null
              }

              const findExisting = async (record: LibraryImportBookInput): Promise<ExistingImportMatch | null> => {
                if (record.isbn) {
                  const rows = await tx
                    .select({
                      userBookId: userBooks.id,
                      bookId: books.id,
                      bookSource: books.source,
                      createdByUserId: books.createdByUserId
                    })
                    .from(userBooks)
                    .innerJoin(books, eq(userBooks.bookId, books.id))
                    .where(and(eq(userBooks.userId, userId), eq(books.isbn, record.isbn), isNull(userBooks.removedAt)))
                    .limit(1)
                  if (rows[0]) return rows[0]
                }

                const rows = await tx
                  .select({
                    userBookId: userBooks.id,
                    bookId: books.id,
                    bookSource: books.source,
                    createdByUserId: books.createdByUserId,
                    authorName: authors.name
                  })
                  .from(userBooks)
                  .innerJoin(books, eq(userBooks.bookId, books.id))
                  .leftJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
                  .leftJoin(authors, eq(bookAuthors.authorId, authors.id))
                  .where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt), eq(sql`lower(${books.title})`, normalizeConflictText(record.title))))

                const importAuthorKeys = new Set(record.authors.map(normalizeConflictText))
                const matched = rows.find(row => row.authorName && importAuthorKeys.has(normalizeConflictText(row.authorName)))
                return matched
                  ? {
                      userBookId: matched.userBookId,
                      bookId: matched.bookId,
                      bookSource: matched.bookSource,
                      createdByUserId: matched.createdByUserId
                    }
                  : null
              }

              for (const [index, record] of records.entries()) {
                const rowNumber = index + 2
                try {
                  const now = new Date()
                  const existing = await findExisting(record)

                  if (existing && conflictStrategy === 'existing') {
                    result.skipped++
                    continue
                  }

                  const locationId = await resolveLocationId(record.locationPath, now)
                  const userBookValues = {
                    locationId,
                    rating: record.rating,
                    note: record.note,
                    readingStatus: record.readingStatus,
                    currentPage: record.currentPage,
                    progressPercent: record.progressPercent
                  }

                  if (existing) {
                    if (existing.bookSource === 'manual' && existing.createdByUserId === userId) {
                      await tx.update(books)
                        .set({
                          title: record.title,
                          isbn: record.isbn
                        })
                        .where(and(eq(books.id, existing.bookId), eq(books.source, 'manual'), eq(books.createdByUserId, userId)))
                      await setAuthors(existing.bookId, record.authors, now)
                    }

                    await tx.update(userBooks)
                      .set(userBookValues)
                      .where(and(eq(userBooks.id, existing.userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
                    await setTags(existing.userBookId, record.tags, now)
                    result.updated++
                    continue
                  }

                  let bookId: string | null = null
                  if (record.isbn) {
                    const shared = await tx
                      .select({ id: books.id })
                      .from(books)
                      .where(and(eq(books.isbn, record.isbn), eq(books.source, 'open_library')))
                      .limit(1)
                    bookId = shared[0]?.id ?? null
                  }

                  if (!bookId) {
                    bookId = generateId()
                    await tx.insert(books).values({
                      id: bookId,
                      isbn: record.isbn,
                      title: record.title,
                      coverPath: null,
                      openLibraryKey: null,
                      workKey: null,
                      description: null,
                      publishDate: null,
                      publishers: null,
                      numberOfPages: null,
                      source: 'manual',
                      createdByUserId: userId,
                      createdAt: now
                    })
                    await setAuthors(bookId, record.authors, now)
                  }

                  const userBookId = generateId()
                  await tx.insert(userBooks).values({
                    id: userBookId,
                    userId,
                    bookId,
                    ...userBookValues,
                    addedAt: record.addedAt ?? now
                  })
                  await setTags(userBookId, record.tags, now)
                  result.created++
                } catch (error) {
                  result.failed.push({
                    row: rowNumber,
                    title: record.title,
                    reason: error instanceof Error ? error.message : 'Unable to import row'
                  })
                }
              }
            })

            return result
          },
          catch: error => new DatabaseError({
            message: `Failed to import library: ${error}`,
            operation: 'libraryTransfer.importRecords'
          })
        })
    }
  })
)
