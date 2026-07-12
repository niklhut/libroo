import { Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  LIBRARY_CSV_MAX_CELL_LENGTH,
  LIBRARY_CSV_MAX_DATA_ROWS,
  LIBRARY_CSV_MAX_LIST_ITEM_LENGTH,
  LIBRARY_CSV_MAX_LIST_ITEMS,
  libraryCsvColumns
} from '../../../../shared/utils/library-transfer-csv'
import { LOCATION_MAX_DEPTH } from '../../../../shared/utils/location-hierarchy'
import type { LibraryImportResult } from '../../../../shared/types/library-transfer'
import { LibraryTransferRepository } from '../../../../server/repositories/library-transfer.repository'
import {
  importLibraryCsv,
  InvalidLibraryCsvError,
  LibraryTransferServiceLive
} from '../../../../server/services/library-transfer.service'

const header = libraryCsvColumns.join(',')
const result: LibraryImportResult = { created: 1, updated: 0, skipped: 0, failed: [] }

function runImport(csv: string, importRecords = vi.fn(() => Effect.succeed(result))) {
  const repository = {
    listExportRecords: vi.fn(() => Effect.succeed([])),
    importRecords
  }
  const effect = importLibraryCsv('user-1', csv, 'existing').pipe(
    Effect.provide(LibraryTransferServiceLive),
    Effect.provide(Layer.succeed(LibraryTransferRepository, repository))
  )

  return { importRecords, effect: Effect.runPromise(Effect.either(effect)) }
}

describe('LibraryTransferService.importLibraryCsv', () => {
  it.each([
    ['title is required', `${[...libraryCsvColumns.filter(column => column !== 'title'), 'title'].join(',')}\n[""Ada""]`],
    ['Invalid JSON in tags field', `${header}\nDune,,,[not valid JSON]`],
    [`CSV has too many data rows (maximum ${LIBRARY_CSV_MAX_DATA_ROWS})`, `${header}\n${Array.from({ length: LIBRARY_CSV_MAX_DATA_ROWS + 1 }, () => 'Dune').join('\n')}`],
    [`CSV column title is too long (maximum ${LIBRARY_CSV_MAX_CELL_LENGTH} characters)`, `${header}\n${'a'.repeat(LIBRARY_CSV_MAX_CELL_LENGTH + 1)}`],
    [`Too many tags in row (maximum ${LIBRARY_CSV_MAX_LIST_ITEMS})`, `${header}\nDune,,,"${Array.from({ length: LIBRARY_CSV_MAX_LIST_ITEMS + 1 }, () => 'tag').join(';')}"`],
    [`tags item is too long (maximum ${LIBRARY_CSV_MAX_LIST_ITEM_LENGTH} characters)`, `${header}\nDune,,,${'a'.repeat(LIBRARY_CSV_MAX_LIST_ITEM_LENGTH + 1)}`],
    [`Location nesting is too deep (maximum ${LOCATION_MAX_DEPTH} levels)`, `${header}\nDune,,,,${Array.from({ length: LOCATION_MAX_DEPTH + 1 }, (_, index) => `Shelf ${index}`).join(' - ')}`]
  ])('returns InvalidLibraryCsvError for %s without importing', async (message, csv) => {
    const { effect, importRecords } = runImport(csv)
    const outcome = await effect

    expect(outcome._tag).toBe('Left')
    if (outcome._tag === 'Left') {
      expect(outcome.left).toBeInstanceOf(InvalidLibraryCsvError)
      expect(outcome.left.message).toBe(message)
    }
    expect(importRecords).not.toHaveBeenCalled()
  })

  it('imports a maximal valid CSV and returns the repository result', async () => {
    const csv = `${header}\n${Array.from({ length: LIBRARY_CSV_MAX_DATA_ROWS }, (_, index) => `Dune ${index}`).join('\n')}`
    const { effect, importRecords } = runImport(csv)

    await expect(effect).resolves.toMatchObject({ _tag: 'Right', right: result })
    expect(importRecords).toHaveBeenCalledWith('user-1', expect.objectContaining({ length: LIBRARY_CSV_MAX_DATA_ROWS }), 'existing')
  })
})
