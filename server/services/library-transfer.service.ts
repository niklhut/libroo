import { Context, Data, Effect, Layer } from 'effect'
import {
  formatCsvList,
  formatLibraryCsv,
  parseCsvList,
  parseLibraryCsvRows,
  type LibraryCsvRow
} from '../../shared/utils/library-transfer-csv'
import { BOOK_LOCATION_PATH_SEPARATOR_PATTERN } from '../../shared/utils/book-location'
import { LOCATION_MAX_DEPTH } from '../../shared/utils/location-hierarchy'
import type {
  LibraryImportBookInput,
  LibraryImportConflictStrategy,
  LibraryImportResult
} from '../../shared/types/library-transfer'
import type { LibraryState, ReadingStatus } from '../../shared/types/book'
import { isValidIsbn, normalizeIsbnIdentity, normalizeIsbnText } from '../../shared/utils/isbn'
import { getBooksEnrichmentConfig } from '../utils/books-config'
import type { DatabaseError } from '../repositories/book.repository'
import { BookEnrichmentRepository } from '../repositories/book-enrichment.repository'
import { LibraryTransferRepository } from '../repositories/library-transfer.repository'
import type { DbService } from './db.service'
import { deleteBlob, type StorageService } from './storage.service'

export class InvalidLibraryCsvError extends Data.TaggedError('InvalidLibraryCsvError')<{
  message: string
}> { }

export interface LibraryTransferServiceInterface {
  exportLibraryCsv: (userId: string) => Effect.Effect<string, DatabaseError, DbService>
  importLibraryCsv: (
    userId: string,
    csv: string,
    conflictStrategy: LibraryImportConflictStrategy,
    enrich: boolean
  ) => Effect.Effect<LibraryImportResult, InvalidLibraryCsvError | DatabaseError, BookEnrichmentRepository | DbService | StorageService>
}

export class LibraryTransferService extends Context.Tag('LibraryTransferService')<
  LibraryTransferService,
  LibraryTransferServiceInterface
>() { }

function serializeDate(value: Date | string | null | undefined): string {
  if (!value) return ''
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}

function parseNullableInteger(value: string, field: string, min: number, max: number): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be between ${min} and ${max}`)
  }
  return parsed
}

function parseNullableDate(value: string, field: string): Date | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} must be a valid date`)
  }
  return date
}

function parseList(value: string, fieldName: string): string[] {
  return parseCsvList(value, fieldName)
}

function parseReadingStatus(value: string): ReadingStatus {
  const status = value.trim() || 'unread'
  if (status === 'unread' || status === 'reading' || status === 'read') return status
  throw new Error('reading_status must be unread, reading, or read')
}

function parseLibraryState(value: string): LibraryState {
  const state = value.trim() || 'owned'
  if (state === 'owned' || state === 'wishlisted' || state === 'previously_owned') return state
  throw new Error('library_state must be owned, wishlisted, or previously_owned')
}

function toImportRecord(row: LibraryCsvRow): LibraryImportBookInput {
  const title = row.title.trim()
  if (!title) {
    throw new Error('title is required')
  }

  const locationPath = row.location.trim() || null
  if (locationPath) {
    const locationDepth = locationPath.split(BOOK_LOCATION_PATH_SEPARATOR_PATTERN)
      .filter(segment => segment.trim() !== '').length
    if (locationDepth > LOCATION_MAX_DEPTH) {
      throw new Error(`Location nesting is too deep (maximum ${LOCATION_MAX_DEPTH} levels)`)
    }
  }

  const rawIsbn = row.isbn.trim()
  const normalizedIsbn = rawIsbn ? normalizeIsbnText(rawIsbn) : null
  const rawSource = row.source.trim()
  if (rawSource && rawSource !== 'manual' && rawSource !== 'open_library') {
    throw new Error('source must be manual or open_library')
  }
  const source: 'manual' | 'open_library' | null
    = rawSource === 'manual' || rawSource === 'open_library' ? rawSource : null
  const rawFormatVersion = row.format_version.trim()
  const formatVersion = rawFormatVersion ? Number(rawFormatVersion) : null
  if (rawFormatVersion && (
    !/^[1-9]\d*$/.test(rawFormatVersion)
    || !Number.isSafeInteger(formatVersion)
  )) {
    throw new Error('format_version must be a positive integer')
  }

  return {
    sourceUserBookId: row.libroo_user_book_id.trim() || null,
    title,
    authors: parseList(row.authors, 'authors'),
    isbn: normalizedIsbn
      ? (isValidIsbn(normalizedIsbn) ? normalizeIsbnIdentity(normalizedIsbn) : normalizedIsbn)
      : null,
    tags: parseList(row.tags, 'tags'),
    locationPath,
    libraryState: parseLibraryState(row.library_state),
    readingStatus: parseReadingStatus(row.reading_status),
    currentPage: parseNullableInteger(row.current_page, 'current_page', 0, 100000),
    progressPercent: parseNullableInteger(row.progress_percent, 'progress_percent', 0, 100),
    rating: parseNullableInteger(row.rating, 'rating', 1, 5),
    note: row.note.trim() || null,
    addedAt: parseNullableDate(row.added_date, 'added_date'),
    source,
    openLibraryKey: row.open_library_key.trim() || null,
    formatVersion
  }
}

export const LibraryTransferServiceLive = Layer.effect(
  LibraryTransferService,
  Effect.gen(function* () {
    const transferRepo = yield* LibraryTransferRepository

    return {
      exportLibraryCsv: userId =>
        Effect.gen(function* () {
          const records = yield* transferRepo.listExportRecords(userId)
          return formatLibraryCsv(records.map(record => ({
            title: record.title,
            authors: formatCsvList(record.authors),
            isbn: record.isbn ?? '',
            tags: formatCsvList(record.tags),
            location: record.location ?? '',
            library_state: record.libraryState,
            reading_status: record.readingStatus,
            current_page: record.currentPage?.toString() ?? '',
            progress_percent: record.progressPercent?.toString() ?? '',
            rating: record.rating?.toString() ?? '',
            note: record.note ?? '',
            added_date: serializeDate(record.addedAt),
            active_loan_status: record.activeLoan?.status ?? '',
            active_loan_borrower: record.activeLoan?.borrowerDisplayName ?? '',
            active_loan_loaned_at: serializeDate(record.activeLoan?.loanedAt),
            active_loan_due_at: serializeDate(record.activeLoan?.dueAt),
            format_version: '2',
            source: record.source,
            open_library_key: record.openLibraryKey ?? '',
            libroo_user_book_id: record.userBookId
          })))
        }),

      importLibraryCsv: (userId, csv, conflictStrategy, enrich) =>
        Effect.gen(function* () {
          const rows = yield* Effect.try({
            try: () => {
              const records: LibraryImportBookInput[] = []
              for (const row of parseLibraryCsvRows(csv)) {
                records.push(toImportRecord(row))
              }
              return records
            },
            catch: error => new InvalidLibraryCsvError({
              message: error instanceof Error ? error.message : 'CSV could not be parsed'
            })
          })

          const imported = yield* transferRepo.importRecords(userId, rows, conflictStrategy, {
            enqueueEnrichment: enrich,
            batchId: crypto.randomUUID(),
            maxAttempts: getBooksEnrichmentConfig().maxAttempts
          })
          const enrichmentRepo = yield* BookEnrichmentRepository
          for (const pathname of new Set(imported.orphanedSharedCoverPaths)) {
            const referenced = yield* enrichmentRepo.isCoverReferenced(pathname).pipe(
              Effect.catchAll(error =>
                Effect.logWarning(`Failed to check replaced import cover ${pathname}: ${String(error)}`).pipe(
                  Effect.as(true)
                )
              )
            )
            if (referenced) continue
            yield* deleteBlob(pathname).pipe(
              Effect.catchAll(error =>
                Effect.logWarning(`Failed to delete replaced import cover ${pathname}: ${String(error)}`)
              )
            )
          }

          const { orphanedSharedCoverPaths: _, ...result } = imported
          return result
        })
    }
  })
)

export const exportLibraryCsv = (userId: string) =>
  Effect.flatMap(LibraryTransferService, service => service.exportLibraryCsv(userId))

export const importLibraryCsv = (
  userId: string,
  csv: string,
  conflictStrategy: LibraryImportConflictStrategy,
  enrich = false
) =>
  Effect.flatMap(LibraryTransferService, service => service.importLibraryCsv(userId, csv, conflictStrategy, enrich))
