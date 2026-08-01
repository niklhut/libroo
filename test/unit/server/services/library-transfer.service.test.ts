import { Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import {
  formatLibraryCsv,
  LIBRARY_CSV_MAX_CELL_LENGTH,
  LIBRARY_CSV_MAX_DATA_ROWS,
  LIBRARY_CSV_MAX_LIST_ITEM_LENGTH,
  LIBRARY_CSV_MAX_LIST_ITEMS,
  libraryCsvColumns
} from '../../../../shared/utils/library-transfer-csv'
import { LOCATION_MAX_DEPTH } from '../../../../shared/utils/location-hierarchy'
import type { LibraryImportResult } from '../../../../shared/types/library-transfer'
import { LibraryTransferRepository } from '../../../../server/repositories/library-transfer.repository'
import { BookEnrichmentRepository } from '../../../../server/repositories/book-enrichment.repository'
import {
  importLibraryCsv,
  InvalidLibraryCsvError,
  LibraryTransferServiceLive
} from '../../../../server/services/library-transfer.service'
import { StorageService } from '../../../../server/services/storage.service'

const header = libraryCsvColumns.join(',')
const publicResult: LibraryImportResult = {
  created: 1,
  updated: 0,
  skipped: 0,
  enrichmentQueued: 0,
  enrichmentBatchId: null,
  failed: []
}
const result = { ...publicResult, orphanedSharedCoverPaths: [] }

function csvWithFormatVersion(formatVersion: string) {
  return `${header}\n${['Dune', ...Array.from({ length: 15 }, () => ''), formatVersion].join(',')}`
}

function runImport(
  csv: string,
  options: {
    importRecords?: ReturnType<typeof vi.fn>
    enrich?: boolean
    isCoverReferenced?: boolean
    acquireLock?: boolean
    isCoverReferencedEffect?: ReturnType<typeof vi.fn>
    acquireIsbnLocksEffect?: ReturnType<typeof vi.fn>
    deleteBlobEffect?: ReturnType<typeof vi.fn>
  } = {}
) {
  const {
    importRecords = vi.fn(() => Effect.succeed(result)),
    enrich = true,
    isCoverReferenced: coverReferenced = false,
    acquireLock = true,
    isCoverReferencedEffect,
    acquireIsbnLocksEffect,
    deleteBlobEffect
  } = options
  const isCoverReferenced = isCoverReferencedEffect ?? vi.fn(() => Effect.succeed(coverReferenced))
  const acquireIsbnLocks = acquireIsbnLocksEffect ?? vi.fn((isbns: string[]) => Effect.succeed(
    acquireLock ? new Set(isbns) : new Set<string>()
  ))
  const releaseIsbnLocks = vi.fn(() => Effect.void)
  const deleteBlob = deleteBlobEffect ?? vi.fn(() => Effect.void)
  const repository = {
    listExportRecords: vi.fn(() => Effect.succeed([])),
    importRecords
  }
  const effect = importLibraryCsv('user-1', csv, 'existing', enrich).pipe(
    Effect.provide(LibraryTransferServiceLive),
    Effect.provide(Layer.succeed(LibraryTransferRepository, repository)),
    Effect.provide(Layer.succeed(BookEnrichmentRepository, {
      isCoverReferenced,
      acquireIsbnLocks,
      releaseIsbnLocks
    } as never)),
    Effect.provide(Layer.succeed(StorageService, {
      put: vi.fn(),
      putCoverImage: vi.fn(),
      get: vi.fn(),
      delete: deleteBlob,
      list: vi.fn()
    }))
  )

  return {
    importRecords,
    isCoverReferenced,
    acquireIsbnLocks,
    releaseIsbnLocks,
    deleteBlob,
    effect: Effect.runPromise(Effect.either(effect))
  }
}

describe('LibraryTransferService.importLibraryCsv', () => {
  it.each([
    ['title is required', `${[...libraryCsvColumns.filter(column => column !== 'title'), 'title'].join(',')}\n[""Ada""]`],
    ['Invalid JSON in tags field', `${header}\nDune,,,[not valid JSON]`],
    [`CSV has too many data rows (maximum ${LIBRARY_CSV_MAX_DATA_ROWS})`, `${header}\n${Array.from({ length: LIBRARY_CSV_MAX_DATA_ROWS + 1 }, () => 'Dune').join('\n')}`],
    [`CSV column title is too long (maximum ${LIBRARY_CSV_MAX_CELL_LENGTH} characters)`, `${header}\n${'a'.repeat(LIBRARY_CSV_MAX_CELL_LENGTH + 1)}`],
    [`Too many tags in row (maximum ${LIBRARY_CSV_MAX_LIST_ITEMS})`, `${header}\nDune,,,"${Array.from({ length: LIBRARY_CSV_MAX_LIST_ITEMS + 1 }, () => 'tag').join(';')}"`],
    [`tags item is too long (maximum ${LIBRARY_CSV_MAX_LIST_ITEM_LENGTH} characters)`, `${header}\nDune,,,${'a'.repeat(LIBRARY_CSV_MAX_LIST_ITEM_LENGTH + 1)}`],
    [`Location nesting is too deep (maximum ${LOCATION_MAX_DEPTH} levels)`, `${header}\nDune,,,,${Array.from({ length: LOCATION_MAX_DEPTH + 1 }, (_, index) => `Shelf ${index}`).join(' - ')}`],
    ['format_version must be a positive integer', csvWithFormatVersion('2beta')],
    ['format_version must be a positive integer', csvWithFormatVersion('1.5')]
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

    await expect(effect).resolves.toMatchObject({ _tag: 'Right', right: publicResult })
    expect(importRecords).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ length: LIBRARY_CSV_MAX_DATA_ROWS }),
      'existing',
      expect.objectContaining({ enqueueEnrichment: true, batchId: expect.any(String) })
    )
  })

  it('canonicalizes ISBN-10 and preserves export provenance for matching', async () => {
    const csv = formatLibraryCsv([{
      title: 'Dune',
      authors: '["Frank Herbert"]',
      isbn: '0-441-17271-7',
      tags: '[]',
      location: '',
      library_state: 'owned',
      reading_status: 'unread',
      current_page: '',
      progress_percent: '',
      rating: '',
      note: '',
      added_date: '',
      active_loan_status: '',
      active_loan_borrower: '',
      active_loan_loaned_at: '',
      active_loan_due_at: '',
      format_version: '2',
      source: 'open_library',
      open_library_key: '/books/OL1M',
      libroo_user_book_id: 'ub-source'
    }])
    const { effect, importRecords } = runImport(csv)

    await expect(effect).resolves.toMatchObject({ _tag: 'Right' })
    expect(importRecords).toHaveBeenCalledWith(
      'user-1',
      [expect.objectContaining({
        sourceUserBookId: 'ub-source',
        isbn: '9780441172719',
        source: 'open_library',
        openLibraryKey: '/books/OL1M',
        formatVersion: 2
      })],
      'existing',
      expect.objectContaining({ enqueueEnrichment: true })
    )
  })

  it('deletes a replaced shared cover only when no record or loan still references it', async () => {
    const importRecords = vi.fn(() => Effect.succeed({
      ...result,
      orphanedSharedCoverPaths: ['covers/9780441172719.webp']
    }))
    const { effect, isCoverReferenced, acquireIsbnLocks, releaseIsbnLocks, deleteBlob } = runImport(`${header}\nDune`, { importRecords })

    await expect(effect).resolves.toMatchObject({ _tag: 'Right' })
    expect(acquireIsbnLocks).toHaveBeenCalledWith(
      ['9780441172719'],
      expect.stringMatching(/^library-import:/),
      expect.any(Date),
      expect.any(Date)
    )
    expect(isCoverReferenced).toHaveBeenCalledWith('covers/9780441172719.webp')
    expect(deleteBlob).toHaveBeenCalledWith('covers/9780441172719.webp')
    expect(releaseIsbnLocks).toHaveBeenCalledWith(['9780441172719'], expect.stringMatching(/^library-import:/))
  })

  it('keeps a replaced shared cover while another record or loan references it', async () => {
    const importRecords = vi.fn(() => Effect.succeed({
      ...result,
      orphanedSharedCoverPaths: ['covers/9780441172719.webp']
    }))
    const { effect, deleteBlob } = runImport(`${header}\nDune`, {
      importRecords,
      isCoverReferenced: true
    })

    await expect(effect).resolves.toMatchObject({ _tag: 'Right' })
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('leaves a replaced shared cover alone while an enrichment worker owns its ISBN lock', async () => {
    const importRecords = vi.fn(() => Effect.succeed({
      ...result,
      orphanedSharedCoverPaths: ['covers/9780441172719.webp']
    }))
    const { effect, isCoverReferenced, releaseIsbnLocks, deleteBlob } = runImport(`${header}\nDune`, {
      importRecords,
      acquireLock: false
    })

    await expect(effect).resolves.toMatchObject({ _tag: 'Right' })
    expect(isCoverReferenced).not.toHaveBeenCalled()
    expect(deleteBlob).not.toHaveBeenCalled()
    expect(releaseIsbnLocks).not.toHaveBeenCalled()
  })

  it('keeps the import successful when acquiring a shared-cover lock fails', async () => {
    const importRecords = vi.fn(() => Effect.succeed({
      ...result,
      orphanedSharedCoverPaths: ['covers/9780441172719.webp']
    }))
    const acquireIsbnLocksEffect = vi.fn(() => Effect.fail(new Error('lock unavailable')))
    const { effect, isCoverReferenced, releaseIsbnLocks, deleteBlob } = runImport(`${header}\nDune`, {
      importRecords,
      acquireIsbnLocksEffect
    })

    await expect(effect).resolves.toMatchObject({ _tag: 'Right', right: publicResult })
    expect(isCoverReferenced).not.toHaveBeenCalled()
    expect(deleteBlob).not.toHaveBeenCalled()
    expect(releaseIsbnLocks).not.toHaveBeenCalled()
  })

  it('keeps the import successful when checking a shared cover reference fails', async () => {
    const importRecords = vi.fn(() => Effect.succeed({
      ...result,
      orphanedSharedCoverPaths: ['covers/9780441172719.webp']
    }))
    const isCoverReferencedEffect = vi.fn(() => Effect.fail(new Error('reference check unavailable')))
    const { effect, deleteBlob, releaseIsbnLocks } = runImport(`${header}\nDune`, {
      importRecords,
      isCoverReferencedEffect
    })

    await expect(effect).resolves.toMatchObject({ _tag: 'Right', right: publicResult })
    expect(deleteBlob).not.toHaveBeenCalled()
    expect(releaseIsbnLocks).toHaveBeenCalledOnce()
  })

  it('keeps the import successful when deleting an unreferenced shared cover fails', async () => {
    const importRecords = vi.fn(() => Effect.succeed({
      ...result,
      orphanedSharedCoverPaths: ['covers/9780441172719.webp']
    }))
    const deleteBlobEffect = vi.fn(() => Effect.fail(new Error('blob storage unavailable')))
    const { effect, deleteBlob, releaseIsbnLocks } = runImport(`${header}\nDune`, {
      importRecords,
      deleteBlobEffect
    })

    await expect(effect).resolves.toMatchObject({ _tag: 'Right', right: publicResult })
    expect(deleteBlob).toHaveBeenCalledWith('covers/9780441172719.webp')
    expect(releaseIsbnLocks).toHaveBeenCalledOnce()
  })

  it('does not enqueue enrichment without explicit opt-in', async () => {
    const { effect, importRecords } = runImport(`${header}\nDune`, { enrich: false })

    await expect(effect).resolves.toMatchObject({ _tag: 'Right' })
    expect(importRecords).toHaveBeenCalledWith(
      'user-1',
      expect.any(Array),
      'existing',
      expect.objectContaining({ enqueueEnrichment: false })
    )
  })
})
