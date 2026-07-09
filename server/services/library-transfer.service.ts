import { Context, Data, Effect, Layer } from 'effect'
import {
  formatCsvList,
  formatLibraryCsv,
  parseCsvList,
  parseLibraryCsv,
  type LibraryCsvRow
} from '../../shared/utils/library-transfer-csv'
import type {
  LibraryImportBookInput,
  LibraryImportConflictStrategy,
  LibraryImportResult
} from '../../shared/types/library-transfer'
import type { LibraryState, ReadingStatus } from '../../shared/types/book'

export class InvalidLibraryCsvError extends Data.TaggedError('InvalidLibraryCsvError')<{
  message: string
}> { }

export interface LibraryTransferServiceInterface {
  exportLibraryCsv: (userId: string) => Effect.Effect<string, DatabaseError, DbService>
  importLibraryCsv: (
    userId: string,
    csv: string,
    conflictStrategy: LibraryImportConflictStrategy
  ) => Effect.Effect<LibraryImportResult, InvalidLibraryCsvError | DatabaseError, DbService>
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

function parseList(value: string): string[] {
  return parseCsvList(value)
}

function parseReadingStatus(value: string): ReadingStatus {
  const status = value.trim() || 'unread'
  if (status === 'unread' || status === 'reading' || status === 'read') return status
  throw new Error('reading_status must be unread, reading, or read')
}

function parseLibraryState(value: string): LibraryState {
  const state = value.trim() || 'owned'
  if (state === 'owned' || state === 'wishlisted') return state
  throw new Error('library_state must be owned or wishlisted')
}

function toImportRecord(row: LibraryCsvRow): LibraryImportBookInput {
  const title = row.title.trim()
  if (!title) {
    throw new Error('title is required')
  }

  return {
    title,
    authors: parseList(row.authors),
    isbn: row.isbn.trim() || null,
    tags: parseList(row.tags),
    locationPath: row.location.trim() || null,
    libraryState: parseLibraryState(row.library_state),
    readingStatus: parseReadingStatus(row.reading_status),
    currentPage: parseNullableInteger(row.current_page, 'current_page', 0, 100000),
    progressPercent: parseNullableInteger(row.progress_percent, 'progress_percent', 0, 100),
    rating: parseNullableInteger(row.rating, 'rating', 1, 5),
    note: row.note.trim() || null,
    addedAt: parseNullableDate(row.added_date, 'added_date')
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
            active_loan_due_at: serializeDate(record.activeLoan?.dueAt)
          })))
        }),

      importLibraryCsv: (userId, csv, conflictStrategy) =>
        Effect.gen(function* () {
          const rows = yield* Effect.try({
            try: () => parseLibraryCsv(csv).map(toImportRecord),
            catch: error => new InvalidLibraryCsvError({
              message: error instanceof Error ? error.message : 'CSV could not be parsed'
            })
          })

          return yield* transferRepo.importRecords(userId, rows, conflictStrategy)
        })
    }
  })
)

export const exportLibraryCsv = (userId: string) =>
  Effect.flatMap(LibraryTransferService, service => service.exportLibraryCsv(userId))

export const importLibraryCsv = (
  userId: string,
  csv: string,
  conflictStrategy: LibraryImportConflictStrategy
) =>
  Effect.flatMap(LibraryTransferService, service => service.importLibraryCsv(userId, csv, conflictStrategy))
