import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBooksEnrichmentConfig } from '../../../../server/utils/books-config'

describe('books enrichment configuration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clamps recovery settings to reserve one complete enrichment attempt', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      booksEnrichmentRecoveryTimeBudgetSeconds: '10',
      booksEnrichmentRecoverySafetySeconds: '1'
    }))

    const config = getBooksEnrichmentConfig()

    expect(config.recoveryTimeBudgetSeconds).toBe(36)
    expect(config.recoverySafetySeconds).toBe(35)
  })
})
