import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { authors, bookAuthors, books, locations, loans, tags, userBooks } from 'hub:db:schema'
import type { DbServiceInterface, AtomicDbStatements } from '../services/db.service'
import type { LibraryImportBookInput, LibraryImportRowDetail } from '../../shared/types/library-transfer'
import { normalizeTagInput } from '../../shared/utils/tag-ingestion'
import { isbnIdentityAliases, normalizeIsbnIdentity } from '../../shared/utils/isbn'

export const normalizeImportText = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase()
export const normalizedStoredBookIsbn = sql<string>`replace(replace(upper(${books.isbn}), '-', ''), ' ', '')`
export interface ImportCandidate {
  matchedTitle: string
  userBookId: string
  bookId: string
  bookSource: 'open_library' | 'manual'
  createdByUserId: string | null
  bookIsbn: string | null
  entrySource: 'csv_import' | 'manual_entry' | 'isbn_lookup' | null
  openLibraryKey: string | null
  coverPath: string | null
  metadataProviderIsbn: string | null
  authorKeys: Set<string>
}
export type ExistingImportMatch = ImportCandidate & { matchedBy: NonNullable<LibraryImportRowDetail['matchedBy']> }
export interface ImportLocationNode {
  id: string
  name: string
  parentLocationId: string | null
  path: string
  depth: number
}

function chunks<T>(values: T[]) {
  return Array.from({ length: Math.ceil(values.length / 75) }, (_, index) => values.slice(index * 75, index * 75 + 75))
}

/** Fetch only relevant candidates and dimensions, using indexed owner/name joins.
 * All SELECTs share one database batch; no book-by-book lookup round trips.
 */
export async function prepareImportLookups(database: DbServiceInterface, userId: string, records: LibraryImportBookInput[]) {
  const authorNames = [...new Set(records.flatMap(record => record.authors.length ? record.authors.map(normalizeImportText) : ['unknown author']))]
  const tagNames = [...new Set(records.flatMap(record => record.tags.map(name => normalizeTagInput(name)?.key).filter((key): key is string => !!key)))]
  const locationNames = [...new Set(records.flatMap(record => (record.locationPath ?? '').split(/\s+-\s+/).map(normalizeImportText).filter(Boolean)))]
  const sourceIds = [...new Set(records.map(record => record.sourceUserBookId).filter((id): id is string => !!id))]
  const isbnAliases = [...new Set(records.flatMap(record => record.isbn ? isbnIdentityAliases(record.isbn) : []))]
  const fields = {
    matchedTitle: books.title, userBookId: sql<string>`${userBooks.id}`.as('user_book_id'), bookId: sql<string>`${books.id}`.as('book_id'), bookSource: books.source,
    createdByUserId: books.createdByUserId, bookIsbn: books.isbn, entrySource: books.entrySource,
    openLibraryKey: books.openLibraryKey, coverPath: books.coverPath, metadataProviderIsbn: books.metadataProviderIsbn, authorName: authors.normalizedName
  }
  type CandidateRow = Omit<ImportCandidate, 'authorKeys'> & { authorName: string | null }
  const candidates = new Map<string, ImportCandidate>()
  const shared = new Map<string, ImportCandidate>()
  const authorCache = new Map<string, string>()
  const tagCache = new Map<string, string>()
  const locationCache = new Map<string, ImportLocationNode>()
  const activeLoans = new Set<string>()
  const consume: ((rows: unknown) => void)[] = []
  const readCandidates = (rows: unknown) => {
    for (const { authorName, ...row } of rows as CandidateRow[]) {
      const candidate = candidates.get(row.userBookId) ?? { ...row, authorKeys: new Set<string>() }
      if (authorName) candidate.authorKeys.add(authorName)
      candidates.set(row.userBookId, candidate)
    }
  }
  const results = await database.executeAtomic((db) => {
    const queries: AtomicDbStatements[number][] = []
    const add = (query: AtomicDbStatements[number], read: (rows: unknown) => void) => {
      queries.push(query)
      consume.push(read)
    }
    const ownCandidates = () => db.select(fields).from(userBooks)
      .innerJoin(books, eq(books.id, userBooks.bookId))
      .leftJoin(bookAuthors, eq(bookAuthors.bookId, books.id))
      .leftJoin(authors, eq(authors.id, bookAuthors.authorId))
    for (const ids of chunks(sourceIds)) add(ownCandidates().where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt), inArray(userBooks.id, ids))), readCandidates)
    for (const isbns of chunks(isbnAliases)) add(ownCandidates().where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt), inArray(normalizedStoredBookIsbn, isbns))), readCandidates)
    for (const names of chunks(authorNames)) {
      add(ownCandidates().where(and(eq(userBooks.userId, userId), isNull(userBooks.removedAt), inArray(authors.normalizedName, names))), readCandidates)
      add(db.select({ id: authors.id, key: authors.normalizedName }).from(authors).where(inArray(authors.normalizedName, names)), (rows) => {
        for (const row of rows as { id: string, key: string }[]) authorCache.set(row.key, row.id)
      })
    }
    for (const names of chunks(tagNames)) add(db.select({ id: tags.id, key: tags.normalizedName }).from(tags).where(inArray(tags.normalizedName, names)), (rows) => {
      for (const row of rows as { id: string, key: string }[]) tagCache.set(row.key, row.id)
    })
    for (const names of chunks(locationNames)) add(db.select({
      id: locations.id, name: locations.name, parentLocationId: locations.parentLocationId, path: locations.path, depth: locations.depth, key: locations.normalizedName
    }).from(locations).where(and(eq(locations.userId, userId), inArray(locations.normalizedName, names))), (rows) => {
      for (const row of rows as (ImportLocationNode & { key: string })[]) locationCache.set(`${row.parentLocationId ?? 'root'}:${row.key}`, row)
    })
    add(db.select({ id: loans.userBookId }).from(loans).where(and(eq(loans.ownerUserId, userId), eq(loans.status, 'active'))), (rows) => {
      for (const row of rows as { id: string }[]) activeLoans.add(row.id)
    })
    for (const isbns of chunks(isbnAliases)) add(db.select({
      matchedTitle: books.title, bookId: books.id, bookSource: books.source, createdByUserId: books.createdByUserId,
      bookIsbn: books.isbn, entrySource: books.entrySource, openLibraryKey: books.openLibraryKey, coverPath: books.coverPath,
      metadataProviderIsbn: books.metadataProviderIsbn, authorName: authors.normalizedName
    }).from(books).leftJoin(bookAuthors, eq(bookAuthors.bookId, books.id)).leftJoin(authors, eq(authors.id, bookAuthors.authorId))
      .where(and(eq(books.source, 'open_library'), inArray(normalizedStoredBookIsbn, isbns))), (rows) => {
      for (const row of rows as Omit<CandidateRow, 'userBookId'>[]) {
        if (!row.bookIsbn) continue
        const key = normalizeIsbnIdentity(row.bookIsbn)
        const candidate = shared.get(key) ?? { ...row, userBookId: '', authorKeys: new Set<string>() }
        if (candidate.bookId !== row.bookId) continue
        if (row.authorName) candidate.authorKeys.add(row.authorName)
        shared.set(key, candidate)
      }
    })
    return queries as unknown as AtomicDbStatements
  })
  results.forEach((rows, index) => consume[index]!(rows))
  const isbnIndex = new Map<string, Map<string, ImportCandidate>>()
  const titleIndex = new Map<string, Map<string, ImportCandidate>>()
  const addIndex = (index: Map<string, Map<string, ImportCandidate>>, key: string, candidate: ImportCandidate) => {
    const group = index.get(key) ?? new Map<string, ImportCandidate>()
    group.set(candidate.userBookId, candidate)
    index.set(key, group)
  }
  const indexCandidate = (candidate: ImportCandidate) => {
    if (candidate.bookIsbn) addIndex(isbnIndex, normalizeIsbnIdentity(candidate.bookIsbn), candidate)
    addIndex(titleIndex, normalizeImportText(candidate.matchedTitle), candidate)
  }
  for (const candidate of candidates.values()) indexCandidate(candidate)
  const register = (candidate: ImportCandidate) => {
    const previous = candidates.get(candidate.userBookId)
    if (previous) {
      if (previous.bookIsbn) isbnIndex.get(normalizeIsbnIdentity(previous.bookIsbn))?.delete(previous.userBookId)
      titleIndex.get(normalizeImportText(previous.matchedTitle))?.delete(previous.userBookId)
    }
    candidates.set(candidate.userBookId, candidate)
    indexCandidate(candidate)
  }
  const findExisting = (record: LibraryImportBookInput): ExistingImportMatch | null => {
    if (record.sourceUserBookId) {
      const match = candidates.get(record.sourceUserBookId)
      if (match) return { ...match, matchedBy: 'libroo_id' }
    }
    if (record.isbn) {
      const key = normalizeIsbnIdentity(record.isbn)
      const match = isbnIndex.get(key)?.values().next().value
      return match ? { ...match, matchedBy: 'isbn' } : null
    }
    // The placeholder is saved for display. Title matching requires an author from the CSV.
    if (!record.authors.length) return null
    const keys = record.authors.map(normalizeImportText)
    const title = normalizeImportText(record.title)
    const match = [...(titleIndex.get(title)?.values() ?? [])].find(candidate => keys.some(key => candidate.authorKeys.has(key)))
    return match ? { ...match, matchedBy: 'title_authors' } : null
  }
  return { authorCache, tagCache, locationCache, activeLoans, shared, findExisting, register }
}
