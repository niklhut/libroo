import { afterEach, describe, expect, it, vi } from 'vitest'
import { termsAreConfigured } from '../../../../server/utils/libroo-terms-consent-plugin'

describe('librooTermsConsentPlugin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requires Terms when an external Terms URL is configured', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        legalTermsUrl: 'https://example.com/terms'
      },
      legalTermsMarkdownUrl: ''
    }))

    expect(termsAreConfigured()).toBe(true)
  })

  it('requires Terms when a Markdown Terms source is configured', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        legalTermsUrl: ''
      },
      legalTermsMarkdownUrl: 'https://example.com/terms.md'
    }))

    expect(termsAreConfigured()).toBe(true)
  })

  it('does not require Terms when no Terms source is configured', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        legalTermsUrl: ''
      },
      legalTermsMarkdownUrl: ''
    }))

    expect(termsAreConfigured()).toBe(false)
  })
})
