import type { LibraryState, ReadingStatus } from './book'

export type LibraryImportConflictStrategy = 'existing' | 'csv'

export interface LibraryExportRecord {
  userBookId: string
  title: string
  authors: string[]
  isbn: string | null
  tags: string[]
  location: string | null
  libraryState: LibraryState
  readingStatus: ReadingStatus
  currentPage: number | null
  progressPercent: number | null
  rating: number | null
  note: string | null
  addedAt: Date
  source: 'open_library' | 'manual'
  openLibraryKey: string | null
  activeLoan: {
    status: 'loaned'
    borrowerDisplayName: string
    loanedAt: Date
    dueAt: Date | null
  } | null
}

export interface LibraryImportBookInput {
  sourceUserBookId: string | null
  title: string
  authors: string[]
  isbn: string | null
  tags: string[]
  locationPath: string | null
  libraryState: LibraryState
  readingStatus: ReadingStatus
  currentPage: number | null
  progressPercent: number | null
  rating: number | null
  note: string | null
  addedAt: Date | null
  source: 'open_library' | 'manual' | null
  openLibraryKey: string | null
  formatVersion: number | null
}

export interface LibraryImportRowDetail {
  row: number
  title: string
  status: 'created' | 'updated' | 'skipped' | 'failed' | 'unconfirmed' | 'not_processed'
  userBookId?: string
  matchedBy?: 'libroo_id' | 'isbn' | 'title_authors'
  matchedTitle?: string
  firstRow?: number
  repeatedInFile?: boolean
  reason?: string
}

export interface LibraryImportResult {
  created: number
  updated: number
  skipped: number
  enrichmentQueued: number
  enrichmentBatchId: string | null
  failed: Array<{ row: number, title: string, reason: string }>
  details?: LibraryImportRowDetail[]
}
