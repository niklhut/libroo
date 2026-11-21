import { Context, Data, Effect, Layer } from 'effect'
import { asc, and, eq, inArray, isNull } from 'drizzle-orm'
import { authors, bookAuthors, bookEnrichmentJobs, books, locations, loans, tags, userBooks, userBookTags } from 'hub:db:schema'
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
import { DbService, type AtomicDbStatement, type AtomicDbStatements, type DbServiceInterface } from '../services/db.service'
import { isValidIsbn, normalizeIsbnIdentity } from '../../shared/utils/isbn'

import { prepareImportLookups, normalizeImportText, type ImportLocationNode } from './library-import-lookups'

interface PendingLocationCreate extends ImportLocationNode {
  normalizedName: string
  cacheKey: string
}

class ImportBatchWriteError extends Data.TaggedError('ImportBatchWriteError')<{ cause: unknown }> {}

export interface LibraryImportRepositoryResult extends LibraryImportResult {
  orphanedSharedCoverPaths: string[]
}

export interface LibraryTransferRepositoryInterface {
  listExportRecords: (userId: string) => Effect.Effect<LibraryExportRecord[], DatabaseError, DbService>
  importRecords: (
    userId: string,
    records: LibraryImportBookInput[],
    conflictStrategy: LibraryImportConflictStrategy,
    options: { enqueueEnrichment: boolean, batchId: string, maxAttempts: number }
  ) => Effect.Effect<LibraryImportRepositoryResult, DatabaseError, DbService>
}

export class LibraryTransferRepository extends Context.Service<
  LibraryTransferRepository,
  LibraryTransferRepositoryInterface
>()('LibraryTransferRepository') { }

function generateId(): string {
  return crypto.randomUUID()
}

const normalizeAuthorName = normalizeImportText
const normalizeConflictText = normalizeImportText

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
                openLibraryKey: books.openLibraryKey,
                locationPath: locations.path,
                lastKnownLocation: userBooks.lastKnownLocation,
                libraryState: userBooks.libraryState,
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

            // Scope through ownership instead of binding every exported ID.
            // D1 caps bound parameters at 100, regardless of library size.
            const authorRows = rows.length === 0
              ? []
              : await dbService.db
                  .select({
                    bookId: bookAuthors.bookId,
                    name: authors.name
                  })
                  .from(bookAuthors)
                  .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
                  .where(inArray(
                    bookAuthors.bookId,
                    dbService.db.select({ bookId: userBooks.bookId })
                      .from(userBooks)
                      .where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
                  ))
                  .orderBy(asc(bookAuthors.sortOrder), asc(authors.name))
            const tagRows = rows.length === 0
              ? []
              : await dbService.db
                  .select({
                    userBookId: userBookTags.userBookId,
                    name: tags.name
                  })
                  .from(userBookTags)
                  .innerJoin(tags, eq(userBookTags.tagId, tags.id))
                  .innerJoin(userBooks, eq(userBooks.id, userBookTags.userBookId))
                  .where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt)))
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
              userBookId: row.userBookId,
              title: row.title,
              authors: authorsByBook.get(row.bookId) ?? ['Unknown Author'],
              isbn: row.isbn ?? null,
              tags: tagsByUserBook.get(row.userBookId) ?? [],
              location: row.libraryState === 'previously_owned'
                ? row.lastKnownLocation ?? null
                : row.locationPath ?? null,
              libraryState: row.libraryState,
              readingStatus: row.readingStatus,
              currentPage: row.currentPage ?? null,
              progressPercent: row.progressPercent ?? null,
              rating: row.rating ?? null,
              note: row.note ?? null,
              addedAt: row.addedAt,
              source: row.source,
              openLibraryKey: row.openLibraryKey,
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

      importRecords: (userId, records, conflictStrategy, options) =>
        Effect.tryPromise({
          try: async () => {
            const runImport = async (batched: boolean, input = records, rowOffset = 0): Promise<LibraryImportRepositoryResult> => {
              const result: LibraryImportRepositoryResult = {
                created: 0,
                updated: 0,
                skipped: 0,
                enrichmentQueued: 0,
                enrichmentBatchId: null,
                orphanedSharedCoverPaths: [],
                failed: [],
                details: []
              }
              const lookups = await prepareImportLookups(dbService, userId, input)
              const { authorCache, tagCache, locationCache, findExisting } = lookups
              const plans: ((database: DbServiceInterface['db']) => AtomicDbStatements)[] = []

              for (const [index, record] of input.entries()) {
                const rowNumber = index + rowOffset + 2
                try {
                  const now = new Date()
                  const existing = await findExisting(record)

                  if (existing && conflictStrategy === 'existing') {
                    result.skipped++
                    result.details!.push({ row: rowNumber, title: record.title, status: 'skipped', userBookId: existing.userBookId, matchedBy: existing.matchedBy, matchedTitle: existing.matchedTitle })
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

                  const isWishlisted = record.libraryState === 'wishlisted'
                  const isPreviouslyOwned = record.libraryState === 'previously_owned'
                  if (existing && (isWishlisted || isPreviouslyOwned)) {
                    if (lookups.activeLoans.has(existing.userBookId)) {
                      throw new Error(`Cannot move a book with an active loan to ${isPreviouslyOwned ? 'previously_owned' : 'the wishlist'}`)
                    }
                  }
                  const locationId = isWishlisted || isPreviouslyOwned ? null : await resolveLocationId(record.locationPath)
                  const userBookValues = {
                    locationId,
                    libraryState: record.libraryState,
                    lastKnownLocation: isPreviouslyOwned ? record.locationPath : null,
                    rating: isWishlisted ? null : record.rating,
                    note: record.note,
                    readingStatus: isWishlisted ? 'unread' : record.readingStatus,
                    currentPage: isWishlisted ? null : record.currentPage,
                    progressPercent: isWishlisted ? null : record.progressPercent
                  }

                  let sharedOpenLibraryBookId: string | null = null
                  if (!existing && record.isbn) {
                    const candidate = lookups.shared.get(normalizeIsbnIdentity(record.isbn))
                    if (candidate) {
                      const importedAuthorKeys = new Set(record.authors.map(normalizeConflictText))
                      const hasCompatibleAuthor = [...candidate.authorKeys].some(author => importedAuthorKeys.has(author))
                      const trustedProvenance = record.source === 'open_library'
                        && Boolean(record.openLibraryKey)
                        && record.openLibraryKey === candidate.openLibraryKey
                      const compatibleLegacyMetadata = record.source === null
                        && normalizeConflictText(record.title) === normalizeConflictText(candidate.matchedTitle)
                        && hasCompatibleAuthor
                      sharedOpenLibraryBookId = trustedProvenance || compatibleLegacyMetadata
                        ? candidate.bookId
                        : null
                    }
                  }

                  const bookId = existing?.bookId ?? sharedOpenLibraryBookId ?? generateId()
                  const userBookId = existing?.userBookId ?? generateId()
                  const isUserOwnedManualBook = existing?.bookSource === 'manual' && existing.createdByUserId === userId
                  const isNewManualBook = !existing && !sharedOpenLibraryBookId
                  const isImportedManualBook = isUserOwnedManualBook && existing?.entrySource === 'csv_import'
                  const importedIsbn = record.isbn ? normalizeIsbnIdentity(record.isbn) : null
                  const existingBookIsbn = existing?.bookIsbn ? normalizeIsbnIdentity(existing.bookIsbn) : null
                  const metadataProviderIsbn = existing?.metadataProviderIsbn
                    ? normalizeIsbnIdentity(existing.metadataProviderIsbn)
                    : null
                  const isbnChanged = Boolean(existing && existingBookIsbn !== importedIsbn)
                  const providerMetadataIsStale = Boolean(
                    isbnChanged
                    && metadataProviderIsbn
                    && metadataProviderIsbn !== importedIsbn
                  )
                  const shouldQueueEnrichment = options.enqueueEnrichment
                    && Boolean(record.isbn && isValidIsbn(record.isbn))
                    && (isNewManualBook || isImportedManualBook)
                  const shouldSetAuthors = isNewManualBook || isUserOwnedManualBook
                  const authorLinks = shouldSetAuthors ? await resolveAuthorLinks(record.authors) : []
                  const tagLinks = await resolveTagLinks(record.tags)

                  const writeRecord = (database: DbServiceInterface['db']): AtomicDbStatements => {
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
                            isbn: record.isbn,
                            ...(providerMetadataIsStale
                              ? {
                                  coverPath: existing.coverPath?.startsWith('covers/manual/') ? existing.coverPath : null,
                                  openLibraryKey: null,
                                  workKey: null,
                                  description: null,
                                  publishDate: null,
                                  publishers: null,
                                  numberOfPages: null,
                                  metadataProviderIsbn: null
                                }
                              : {})
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
                        entrySource: 'csv_import',
                        metadataProviderIsbn: null,
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

                    if (shouldQueueEnrichment && record.isbn) {
                      const jobId = generateId()
                      statements.push(database.insert(bookEnrichmentJobs).values({
                        id: jobId,
                        batchId: options.batchId,
                        userId,
                        bookId,
                        isbn: record.isbn,
                        status: 'pending',
                        attempts: 0,
                        maxAttempts: options.maxAttempts,
                        createdAt: now,
                        updatedAt: now
                      }).onConflictDoUpdate({
                        target: bookEnrichmentJobs.bookId,
                        set: {
                          batchId: options.batchId,
                          userId,
                          isbn: record.isbn,
                          status: 'pending',
                          attempts: 0,
                          maxAttempts: options.maxAttempts,
                          claimToken: null,
                          leaseExpiresAt: null,
                          nextAttemptAt: null,
                          lastError: null,
                          outcome: null,
                          updatedAt: now,
                          completedAt: null
                        }
                      }))
                    } else if (isImportedManualBook) {
                      statements.push(database.update(bookEnrichmentJobs)
                        .set({
                          status: 'cancelled',
                          claimToken: null,
                          leaseExpiresAt: null,
                          nextAttemptAt: null,
                          lastError: 'Enrichment was disabled by the user',
                          updatedAt: now,
                          completedAt: now
                        })
                        .where(eq(bookEnrichmentJobs.bookId, bookId)))
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
                  }
                  if (batched) plans.push(writeRecord)
                  else await dbService.executeAtomic(writeRecord)

                  const shared = record.isbn ? lookups.shared.get(normalizeIsbnIdentity(record.isbn)) : null
                  lookups.register({
                    userBookId, bookId,
                    matchedTitle: shouldSetAuthors ? record.title : existing?.matchedTitle ?? shared?.matchedTitle ?? record.title,
                    bookSource: existing?.bookSource ?? (sharedOpenLibraryBookId ? 'open_library' : 'manual'),
                    createdByUserId: existing ? existing.createdByUserId : sharedOpenLibraryBookId ? null : userId,
                    bookIsbn: shouldSetAuthors ? record.isbn : existing ? existing.bookIsbn : shared?.bookIsbn ?? record.isbn,
                    entrySource: existing ? existing.entrySource : sharedOpenLibraryBookId ? shared?.entrySource ?? null : 'csv_import',
                    coverPath: providerMetadataIsStale && !existing?.coverPath?.startsWith('covers/manual/') ? null : existing ? existing.coverPath : shared?.coverPath ?? null,
                    openLibraryKey: providerMetadataIsStale ? null : existing ? existing.openLibraryKey : shared?.openLibraryKey ?? null,
                    metadataProviderIsbn: providerMetadataIsStale ? null : existing ? existing.metadataProviderIsbn : shared?.metadataProviderIsbn ?? null,
                    authorKeys: shouldSetAuthors ? new Set((record.authors.length ? record.authors : ['Unknown Author']).map(normalizeAuthorName)) : existing?.authorKeys ?? shared?.authorKeys ?? new Set<string>()
                  })
                  for (const updateCache of cacheUpdates) updateCache()
                  if (
                    providerMetadataIsStale
                    && existing?.coverPath
                    && !existing.coverPath.startsWith('covers/manual/')
                  ) {
                    result.orphanedSharedCoverPaths.push(existing.coverPath)
                  }

                  if (existing) {
                    result.updated++
                  } else {
                    result.created++
                  }
                  result.details!.push({ row: rowNumber, title: record.title, status: existing ? 'updated' : 'created', userBookId, ...(existing ? { matchedBy: existing.matchedBy, matchedTitle: existing.matchedTitle } : {}) })
                  if (shouldQueueEnrichment) {
                    result.enrichmentQueued++
                    result.enrichmentBatchId = options.batchId
                  }
                } catch (error) {
                  result.details!.push({ row: rowNumber, title: record.title, status: 'failed', reason: error instanceof Error ? error.message : 'Unable to import row' })
                  result.failed.push({
                    row: rowNumber,
                    title: record.title,
                    reason: error instanceof Error ? error.message : 'Unable to import row'
                  })
                }
              }

              if (batched && plans.length) {
                try {
                  await dbService.executeAtomic(database => plans.flatMap(build => build(database)) as unknown as AtomicDbStatements)
                } catch (cause) {
                  throw new ImportBatchWriteError({ cause })
                }
              }
              return result
            }
            const importRange = async (input: LibraryImportBookInput[], offset: number): Promise<LibraryImportRepositoryResult> => {
              try {
                return await runImport(true, input, offset)
              } catch (error) {
                if (!(error instanceof ImportBatchWriteError)) throw error
                if (input.length === 1) return runImport(false, input, offset)
                // Isolate rejected rows by splitting the rolled-back batch. Valid
                // halves stay batched, rather than making every row a round trip.
                const middle = Math.floor(input.length / 2)
                const first = await importRange(input.slice(0, middle), offset)
                const second = await importRange(input.slice(middle), offset + middle)
                return {
                  created: first.created + second.created, updated: first.updated + second.updated,
                  skipped: first.skipped + second.skipped,
                  enrichmentQueued: first.enrichmentQueued + second.enrichmentQueued,
                  enrichmentBatchId: first.enrichmentBatchId ?? second.enrichmentBatchId,
                  failed: [...first.failed, ...second.failed], details: [...first.details ?? [], ...second.details ?? []],
                  orphanedSharedCoverPaths: [...first.orphanedSharedCoverPaths, ...second.orphanedSharedCoverPaths]
                }
              }
            }
            return await importRange(records, 0)
          },
          catch: error => new DatabaseError({
            message: `Failed to import library: ${error}`,
            operation: 'libraryTransfer.importRecords'
          })
        })
    }
  })
)
