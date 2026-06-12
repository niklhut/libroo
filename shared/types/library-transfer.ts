import type { ReadingStatus } from './book'

export type LibraryImportConflictStrategy = 'existing' | 'csv'

export interface LibraryExportRecord {
  title: string
  authors: string[]
  isbn: string | null
  tags: string[]
  location: string | null
  readingStatus: ReadingStatus
  currentPage: number | null
  progressPercent: number | null
  rating: number | null
  note: string | null
  addedAt: Date
  source: 'open_library' | 'manual'
  activeLoan: {
    status: 'loaned'
    borrowerDisplayName: string
    loanedAt: Date
    dueAt: Date | null
  } | null
}

export interface LibraryImportBookInput {
  title: string
  authors: string[]
  isbn: string | null
  tags: string[]
  locationPath: string | null
  readingStatus: ReadingStatus
  currentPage: number | null
  progressPercent: number | null
  rating: number | null
  note: string | null
  addedAt: Date | null
}

export interface LibraryImportResult {
  created: number
  updated: number
  skipped: number
  failed: Array<{ row: number, title: string, reason: string }>
}
