import { describe, expect, it } from 'vitest'
import { LIBRARY_CSV_MAX_BYTES } from '../../shared/utils/library-transfer-csv'
import { libraryImportSchema } from '../../shared/utils/schemas'

describe('libraryImportSchema', () => {
  it('enforces the CSV size limit in UTF-8 bytes', () => {
    const withinLimit = '€'.repeat(Math.floor(LIBRARY_CSV_MAX_BYTES / 3))
    const overLimit = `${withinLimit}€`

    expect(libraryImportSchema.safeParse({ csv: withinLimit }).success).toBe(true)
    expect(libraryImportSchema.safeParse({ csv: overLimit })).toMatchObject({
      success: false,
      error: { issues: [{ message: 'CSV file is too large' }] }
    })
  })
})
