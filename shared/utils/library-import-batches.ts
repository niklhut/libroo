import type { LibraryImportConflictStrategy, LibraryImportResult, LibraryImportRowDetail } from '../types/library-transfer'
import { formatLibraryCsv, parseLibraryCsv, parseCsvList } from './library-transfer-csv'

// Lookup reads and normal writes each use one database batch. Bound both row
// count and dimension work to keep CPU, payloads and fallback work manageable.
export const LIBRARY_IMPORT_BATCH_SIZE = 25
export const LIBRARY_IMPORT_FIELD_BUDGET = 200
export function libraryImportWork(record: { authors: string[], tags: string[], locationPath: string | null }) {
  return Math.max(1, record.authors.length + record.tags.length + (record.locationPath?.split(/\s[-–—]\s|[/>]/).length ?? 0))
}

export interface LibraryImportBatchRequest {
  csv: string
  conflictStrategy: LibraryImportConflictStrategy
  enrich: boolean
  continueOnInvalidRows?: boolean
}
export interface LibraryImportReport {
  result: LibraryImportResult
  processedRows: number
  totalRows: number
  enrichmentBatchIds: string[]
  interrupted: boolean
}

export async function importLibraryCsvInBatches(
  input: LibraryImportBatchRequest,
  send: (body: LibraryImportBatchRequest) => Promise<LibraryImportResult>,
  onProgress: (processed: number, total: number) => void = () => {}
): Promise<LibraryImportReport> {
  // Parse the entire file first: malformed CSV must not start a partial import.
  const rows = parseLibraryCsv(input.csv)
  const work = rows.map((row) => {
    try {
      return libraryImportWork({ authors: parseCsvList(row.authors), tags: parseCsvList(row.tags), locationPath: row.location || null })
    } catch {
      // The server reports invalid authored values against their original row.
      return 1
    }
  })
  const result: LibraryImportResult = { created: 0, updated: 0, skipped: 0, enrichmentQueued: 0, enrichmentBatchId: null, failed: [], details: [] }
  const batchIds = new Set<string>()
  const seenBookIds = new Map<string, number>()
  const report = (): LibraryImportReport => ({ result, processedRows, totalRows: rows.length, enrichmentBatchIds: [...batchIds], interrupted })
  let processedRows = 0
  let interrupted = false
  onProgress(0, rows.length)
  for (let offset = 0; offset < rows.length;) {
    let end = offset
    let fields = 0
    while (end < rows.length && end - offset < LIBRARY_IMPORT_BATCH_SIZE && (end === offset || fields + work[end]! <= LIBRARY_IMPORT_FIELD_BUDGET)) {
      fields += work[end]!
      end++
    }
    const batch = rows.slice(offset, end)
    let response: LibraryImportResult
    try {
      response = await send({ ...input, csv: formatLibraryCsv(batch), continueOnInvalidRows: true })
    } catch (error) {
      // A failed request may already have committed rows. Stop rather than
      // retrying automatically; "keep existing" makes a manual retry safe.
      interrupted = true
      const message = typeof error === 'object' && error && 'data' in error
        ? (error as { data?: { message?: string } }).data?.message
        : undefined
      const reason = message || (error instanceof Error ? error.message : 'Import request failed')
      result.details!.push(...batch.map((row, index) => ({ row: offset + index + 2, title: row.title, status: 'unconfirmed' as const, reason: `${reason}. Some rows may already be saved.` })))
      result.details!.push(...rows.slice(offset + batch.length).map((row, index) => ({ row: offset + batch.length + index + 2, title: row.title, status: 'not_processed' as const, reason: 'Not sent because the import stopped.' })))
      break
    }
    for (const detail of response.details ?? response.failed.map(failure => ({ ...failure, status: 'failed' as const }))) {
      const adjusted: LibraryImportRowDetail = { ...detail, row: detail.row + offset }
      if ('userBookId' in detail && detail.userBookId) {
        adjusted.repeatedInFile = seenBookIds.has(detail.userBookId)
        adjusted.firstRow = seenBookIds.get(detail.userBookId)
        if (!adjusted.repeatedInFile) seenBookIds.set(detail.userBookId, adjusted.row)
      }
      result.details!.push(adjusted)
    }
    result.created += response.created
    result.updated += response.updated
    result.skipped += response.skipped
    result.enrichmentQueued += response.enrichmentQueued
    result.failed.push(...response.failed.map(failure => ({ ...failure, row: failure.row + offset })))
    if (response.enrichmentBatchId) {
      batchIds.add(response.enrichmentBatchId)
      result.enrichmentBatchId ??= response.enrichmentBatchId
    }
    processedRows += batch.length
    offset = end
    onProgress(processedRows, rows.length)
  }
  return report()
}
