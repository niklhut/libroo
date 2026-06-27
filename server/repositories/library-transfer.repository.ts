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
import { DatabaseError } from './book.repository'
import { DbService, type AtomicDbStatement } from '../services/db.service'

interface ExistingImportMatch {
  userBookId: string
  bookId: string
  bookSource: 'open_library' | 'manual'
  createdByUserId: string | null
}

interface ImportLocationNode {
  id: string
  name: string
  parentLocationId: string | null
  path: string
  depth: number
}

interface PendingLocationCreate extends ImportLocationNode {
  normalizedName: string
  cacheKey: string
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

function locationParentId(parent: ImportLocationNode | null) {
  return parent?.id ?? null
}

function locationChildDepth(parent: ImportLocationNode | null) {
  return parent ? parent.depth + 1 : 0
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
            const authorCache = new Map<string, string>()
            const tagCache = new Map<string, string>()
            const locationCache = new Map<string, ImportLocationNode>()

            const findExisting = async (record: LibraryImportBookInput): Promise<ExistingImportMatch | null> => {
              if (record.isbn) {
                const rows = await dbService.db
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
                return rows[0] ?? null
              }

              const rows = await dbService.db
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

                const authorCreates: Array<{ id: string, name: string, normalizedName: string }> = []
                const tagCreates: Array<{ id: string, name: string, normalizedName: string }> = []
                const locationCreates: PendingLocationCreate[] = []
                const cacheUpdates: Array<() => void> = []
                const recordAuthorCache = new Map<string, string>()
                const recordTagCache = new Map<string, string>()
                const recordLocationCache = new Map<string, ImportLocationNode>()

                const resolveAuthorId = async (name: string) => {
                  const displayName = name.trim().replace(/\s+/g, ' ') || 'Unknown Author'
                  const normalizedName = normalizeAuthorName(displayName)
                  const cachedId = recordAuthorCache.get(normalizedName) ?? authorCache.get(normalizedName)
                  if (cachedId) return cachedId

                  const existingAuthor = await dbService.db
                    .select({ id: authors.id })
                    .from(authors)
                    .where(eq(authors.normalizedName, normalizedName))
                    .limit(1)
                  if (existingAuthor[0]) {
                    authorCache.set(normalizedName, existingAuthor[0].id)
                    return existingAuthor[0].id
                  }

                  const id = generateId()
                  authorCreates.push({ id, name: displayName, normalizedName })
                  recordAuthorCache.set(normalizedName, id)
                  cacheUpdates.push(() => authorCache.set(normalizedName, id))
                  return id
                }

                const resolveTagId = async (name: string) => {
                  const normalized = normalizeTagInput(name)
                  if (!normalized) return null

                  const cachedId = recordTagCache.get(normalized.key) ?? tagCache.get(normalized.key)
                  if (cachedId) return cachedId

                  const existingTag = await dbService.db
                    .select({ id: tags.id })
                    .from(tags)
                    .where(eq(tags.normalizedName, normalized.key))
                    .limit(1)
                  if (existingTag[0]) {
                    tagCache.set(normalized.key, existingTag[0].id)
                    return existingTag[0].id
                  }

                  const id = generateId()
                  tagCreates.push({ id, name: normalized.displayName, normalizedName: normalized.key })
                  recordTagCache.set(normalized.key, id)
                  cacheUpdates.push(() => tagCache.set(normalized.key, id))
                  return id
                }

                const resolveLocationId = async (path: string | null) => {
                  if (!path) return null

                  const parts = splitLocationPath(path)
                  if (parts.length === 0) return null

                  let parent: ImportLocationNode | null = null
                  for (const part of parts) {
                    const parentNode: ImportLocationNode | null = parent
                    const normalizedName = normalizeBookLocationKey(part)
                    const parentId = locationParentId(parentNode)
                    const cacheKey: string = `${parentId ?? 'root'}:${normalizedName}`
                    const cachedLocation = recordLocationCache.get(cacheKey) ?? locationCache.get(cacheKey)
                    if (cachedLocation) {
                      parent = cachedLocation
                      continue
                    }

                    const existingLocation = await dbService.db
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

                    if (existingLocation[0]) {
                      parent = existingLocation[0]
                      locationCache.set(cacheKey, parent)
                      continue
                    }

                    const id = generateId()
                    const locationPath = locationChildPath(parentNode, part)
                    const depth = locationChildDepth(parentNode)
                    const createdLocation: PendingLocationCreate = {
                      id,
                      parentLocationId: parentId,
                      name: part,
                      normalizedName,
                      path: locationPath,
                      depth,
                      cacheKey
                    }
                    locationCreates.push(createdLocation)
                    recordLocationCache.set(cacheKey, createdLocation)
                    cacheUpdates.push(() => locationCache.set(cacheKey, createdLocation))
                    parent = createdLocation
                  }

                  return parent?.id ?? null
                }

                const resolveAuthorLinks = async (names: string[]) => {
                  const seen = new Set<string>()
                  const uniqueNames = names.filter((name) => {
                    const key = normalizeAuthorName(name)
                    if (!key || seen.has(key)) return false
                    seen.add(key)
                    return true
                  })
                  const authorNames = uniqueNames.length > 0 ? uniqueNames : ['Unknown Author']
                  return Promise.all(authorNames.map(async (name, sortOrder) => ({
                    authorId: await resolveAuthorId(name),
                    sortOrder
                  })))
                }

                const resolveTagLinks = async (tagNames: string[]) => {
                  const seen = new Set<string>()
                  const tagLinks: Array<{ id: string, tagId: string }> = []
                  for (const name of tagNames) {
                    const normalized = normalizeTagInput(name)
                    if (!normalized || seen.has(normalized.key)) continue
                    seen.add(normalized.key)
                    const tagId = await resolveTagId(normalized.displayName)
                    if (!tagId) continue
                    tagLinks.push({ id: generateId(), tagId })
                  }
                  return tagLinks
                }

                const locationId = await resolveLocationId(record.locationPath)
                const userBookValues = {
                  locationId,
                  rating: record.rating,
                  note: record.note,
                  readingStatus: record.readingStatus,
                  currentPage: record.currentPage,
                  progressPercent: record.progressPercent
                }

                let sharedOpenLibraryBookId: string | null = null
                if (!existing && record.isbn) {
                  const shared = await dbService.db
                    .select({ id: books.id })
                    .from(books)
                    .where(and(eq(books.isbn, record.isbn), eq(books.source, 'open_library')))
                    .limit(1)
                  sharedOpenLibraryBookId = shared[0]?.id ?? null
                }

                const bookId = existing?.bookId ?? sharedOpenLibraryBookId ?? generateId()
                const userBookId = existing?.userBookId ?? generateId()
                const isUserOwnedManualBook = existing?.bookSource === 'manual' && existing.createdByUserId === userId
                const isNewManualBook = !existing && !sharedOpenLibraryBookId
                const shouldSetAuthors = isNewManualBook || isUserOwnedManualBook
                const authorLinks = shouldSetAuthors ? await resolveAuthorLinks(record.authors) : []
                const tagLinks = await resolveTagLinks(record.tags)

                // D1 commits each imported record independently; earlier successful records are no longer rolled back by a later failed row.
                await dbService.executeAtomic((database) => {
                  const statements: AtomicDbStatement[] = []

                  for (const author of authorCreates) {
                    statements.push(database.insert(authors).values({
                      id: author.id,
                      name: author.name,
                      normalizedName: author.normalizedName,
                      createdAt: now,
                      updatedAt: now
                    }).onConflictDoNothing())
                  }

                  for (const tag of tagCreates) {
                    statements.push(database.insert(tags).values({
                      id: tag.id,
                      name: tag.name,
                      normalizedName: tag.normalizedName,
                      createdAt: now,
                      updatedAt: now
                    }).onConflictDoNothing())
                  }

                  for (const location of locationCreates) {
                    statements.push(database.insert(locations).values({
                      id: location.id,
                      userId,
                      parentLocationId: location.parentLocationId,
                      name: location.name,
                      normalizedName: location.normalizedName,
                      path: location.path,
                      depth: location.depth,
                      createdAt: now,
                      updatedAt: now
                    }))
                  }

                  if (existing) {
                    if (existing.bookSource === 'manual' && existing.createdByUserId === userId) {
                      statements.push(database.update(books)
                        .set({
                          title: record.title,
                          isbn: record.isbn
                        })
                        .where(and(eq(books.id, existing.bookId), eq(books.source, 'manual'), eq(books.createdByUserId, userId))))
                    }
                  } else if (!sharedOpenLibraryBookId) {
                    statements.push(database.insert(books).values({
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
                    }))
                  }

                  if (shouldSetAuthors) {
                    statements.push(database.delete(bookAuthors).where(eq(bookAuthors.bookId, bookId)))
                    for (const author of authorLinks) {
                      statements.push(database.insert(bookAuthors).values({
                        bookId,
                        authorId: author.authorId,
                        sortOrder: author.sortOrder,
                        createdAt: now
                      }).onConflictDoNothing())
                    }
                  }

                  if (existing) {
                    statements.push(database.update(userBooks)
                      .set(userBookValues)
                      .where(and(eq(userBooks.id, existing.userBookId), eq(userBooks.userId, userId), isNull(userBooks.removedAt))))
                  } else {
                    statements.push(database.insert(userBooks).values({
                      id: userBookId,
                      userId,
                      bookId,
                      ...userBookValues,
                      addedAt: record.addedAt ?? now
                    }))
                  }

                  statements.push(database.delete(userBookTags).where(eq(userBookTags.userBookId, userBookId)))
                  for (const tag of tagLinks) {
                    statements.push(database.insert(userBookTags).values({
                      id: tag.id,
                      userBookId,
                      tagId: tag.tagId,
                      createdAt: now,
                      updatedAt: now
                    }).onConflictDoNothing())
                  }

                  return statements as [AtomicDbStatement, ...AtomicDbStatement[]]
                })

                for (const updateCache of cacheUpdates) updateCache()

                if (existing) {
                  result.updated++
                } else {
                  result.created++
                }
              } catch (error) {
                result.failed.push({
                  row: rowNumber,
                  title: record.title,
                  reason: error instanceof Error ? error.message : 'Unable to import row'
                })
              }
            }

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
