import { describe, expect, it, vi } from 'vitest'
import { importLibraryCsvInBatches, LIBRARY_IMPORT_BATCH_SIZE } from '../../shared/utils/library-import-batches'
import { formatLibraryCsv, libraryCsvColumns, parseLibraryCsv, type LibraryCsvRow } from '../../shared/utils/library-transfer-csv'
import type { LibraryImportResult } from '../../shared/types/library-transfer'

function input(count: number) {
  return { csv: formatLibraryCsv(Array.from({ length: count }, (_, i) => ({
    ...Object.fromEntries(libraryCsvColumns.map(key => [key, ''])),
    title: `Book ${i + 1}`, authors: '["Writer"]', note: 'Two lines\nwith a "quoted" note', location: `Shelf ${i % 4}`, library_state: 'owned'
  } as LibraryCsvRow))), conflictStrategy: 'existing' as const, enrich: true }
}
function response(created: number, overrides: Partial<LibraryImportResult> = {}): LibraryImportResult {
  return { created, updated: 0, skipped: 0, failed: [], enrichmentQueued: 0, enrichmentBatchId: null, ...overrides }
}

describe('bounded CSV import requests', () => {
  it('processes a large file sequentially and preserves every field and row', async () => {
    let active = false
    const titles: string[] = []
    const send = vi.fn(async (body) => {
      expect(active).toBe(false)
      active = true
      const rows = parseLibraryCsv(body.csv)
      expect(rows.length).toBeLessThanOrEqual(LIBRARY_IMPORT_BATCH_SIZE)
      expect(body).toMatchObject({ conflictStrategy: 'existing', enrich: true })
      expect(rows[0]?.note).toBe('Two lines\nwith a "quoted" note')
      titles.push(...rows.map(row => row.title))
      await Promise.resolve()
      active = false
      return response(rows.length)
    })
    const progress = vi.fn()
    const report = await importLibraryCsvInBatches(input(658), send, progress)
    expect(send).toHaveBeenCalledTimes(Math.ceil(658 / LIBRARY_IMPORT_BATCH_SIZE))
    expect(new Set(titles).size).toBe(658)
    expect(report).toMatchObject({ processedRows: 658, totalRows: 658, interrupted: false, result: { created: 658, failed: [] } })
    expect(progress).toHaveBeenLastCalledWith(658, 658)
  })

  it('aggregates partial results, enrichment jobs and original CSV row numbers', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(response(LIBRARY_IMPORT_BATCH_SIZE - 1, { skipped: 1, enrichmentQueued: 2, enrichmentBatchId: 'batch-1' }))
      .mockResolvedValueOnce(response(LIBRARY_IMPORT_BATCH_SIZE - 2, { updated: 1, enrichmentBatchId: 'batch-2', failed: [{ row: LIBRARY_IMPORT_BATCH_SIZE + 1, title: 'Last book', reason: 'Invalid location' }] }))
    const report = await importLibraryCsvInBatches(input(LIBRARY_IMPORT_BATCH_SIZE * 2), send)
    expect(report.result).toMatchObject({ created: LIBRARY_IMPORT_BATCH_SIZE * 2 - 3, updated: 1, skipped: 1, enrichmentQueued: 2, failed: [{ row: LIBRARY_IMPORT_BATCH_SIZE * 2 + 1, title: 'Last book', reason: 'Invalid location' }] })
    expect(report.enrichmentBatchIds).toEqual(['batch-1', 'batch-2'])
    expect(report.processedRows).toBe(LIBRARY_IMPORT_BATCH_SIZE * 2)
  })

  it('retains confirmed progress and stops when a request fails', async () => {
    const send = vi.fn().mockResolvedValueOnce(response(LIBRARY_IMPORT_BATCH_SIZE)).mockRejectedValueOnce(new Error('Network interrupted'))
    const report = await importLibraryCsvInBatches(input(LIBRARY_IMPORT_BATCH_SIZE * 3 + 1), send)
    expect(send).toHaveBeenCalledTimes(2)
    expect(report).toMatchObject({ interrupted: true, processedRows: LIBRARY_IMPORT_BATCH_SIZE, totalRows: LIBRARY_IMPORT_BATCH_SIZE * 3 + 1, result: { created: LIBRARY_IMPORT_BATCH_SIZE, failed: [] } })
    expect(report.result.details).toHaveLength(LIBRARY_IMPORT_BATCH_SIZE * 2 + 1)
    expect(report.result.details![0]).toMatchObject({ row: LIBRARY_IMPORT_BATCH_SIZE + 2, status: 'unconfirmed', reason: expect.stringContaining('Network interrupted') })
    expect(report.result.details!.at(-1)).toMatchObject({ row: LIBRARY_IMPORT_BATCH_SIZE * 3 + 2, status: 'not_processed' })
  })

  it('identifies repeated records across batches and preserves matching reasons and original row numbers', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(response(1, { details: [{ row: 2, title: 'First', status: 'created', userBookId: 'same-record' }] }))
      .mockResolvedValueOnce(response(0, { skipped: 1, details: [{ row: 3, title: 'Repeated', status: 'skipped', userBookId: 'same-record', matchedBy: 'title_authors', matchedTitle: 'First' }] }))
    const report = await importLibraryCsvInBatches(input(LIBRARY_IMPORT_BATCH_SIZE * 2), send)
    expect(report.result.details).toEqual([
      expect.objectContaining({ row: 2, status: 'created', repeatedInFile: false }),
      expect.objectContaining({ row: LIBRARY_IMPORT_BATCH_SIZE + 3, status: 'skipped', matchedBy: 'title_authors', matchedTitle: 'First', repeatedInFile: true, firstRow: 2 })
    ])
  })

  it('reduces batch sizes for rows with many related dimensions', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({
      ...Object.fromEntries(libraryCsvColumns.map(key => [key, ''])), title: `Complex ${index}`,
      authors: JSON.stringify(Array.from({ length: 20 }, (_, i) => `Author ${i}`)),
      tags: JSON.stringify(Array.from({ length: 50 }, (_, i) => `Tag ${i}`))
    } as LibraryCsvRow))
    const sizes: number[] = []
    const report = await importLibraryCsvInBatches({ ...input(0), csv: formatLibraryCsv(rows) }, async (body) => {
      const batch = parseLibraryCsv(body.csv)
      sizes.push(batch.length)
      return response(batch.length)
    })
    expect(sizes).toEqual([2, 2, 2, 2, 2])
    expect(report.result.created).toBe(10)
  })

  it('validates the full CSV before sending any requests', async () => {
    const send = vi.fn()
    await expect(importLibraryCsvInBatches({ ...input(2), csv: input(2).csv + '\n"unterminated' }, send)).rejects.toThrow('unterminated')
    expect(send).not.toHaveBeenCalled()
  })
})
