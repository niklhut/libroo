import { afterEach, describe, expect, it, vi } from 'vitest'
import { addTermsAcceptedAtToUserCreateData, enforceTermsAcceptance, termsAreConfigured } from '../../../../server/utils/libroo-terms-consent-plugin'

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

  it('rejects signup when Terms are configured and not accepted', () => {
    stubTermsConfig()

    expect(() => enforceTermsAcceptance({ acceptTerms: false })).toThrow(expect.objectContaining({
      statusCode: 400,
      body: expect.objectContaining({
        code: 'TERMS_ACCEPTANCE_REQUIRED'
      })
    }))
  })

  it('rejects signup when Terms are configured and acceptance is missing', () => {
    stubTermsConfig()

    expect(() => enforceTermsAcceptance({})).toThrow(expect.objectContaining({
      statusCode: 400,
      body: expect.objectContaining({
        code: 'TERMS_ACCEPTANCE_REQUIRED'
      })
    }))
  })

  it('allows signup when Terms are configured and accepted', () => {
    stubTermsConfig()

    expect(() => enforceTermsAcceptance({ acceptTerms: true })).not.toThrow()
  })

  it('does not enforce acceptance when Terms are not configured', () => {
    stubTermsConfig({ termsUrl: '', markdownUrl: '' })

    expect(() => enforceTermsAcceptance({ acceptTerms: false })).not.toThrow()
  })

  it('adds a Terms acceptance timestamp when creating a signup user and Terms are configured', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-06-23T11:30:00.000Z'))
      stubTermsConfig()

      const result = addTermsAcceptedAtToUserCreateData(
        { id: 'user-1', email: 'ada@example.com' },
        { path: '/sign-up/email' }
      )

      expect(result.data).toEqual({
        id: 'user-1',
        email: 'ada@example.com',
        termsAcceptedAt: new Date('2026-06-23T11:30:00.000Z')
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not add a Terms timestamp when Terms are not configured', () => {
    stubTermsConfig({ termsUrl: '', markdownUrl: '' })

    expect(addTermsAcceptedAtToUserCreateData(
      { id: 'user-1', email: 'ada@example.com' },
      { path: '/sign-up/email' }
    )).toEqual({
      data: {
        id: 'user-1',
        email: 'ada@example.com'
      }
    })
  })

  it('does not add a Terms timestamp outside signup user creation', () => {
    stubTermsConfig()

    expect(addTermsAcceptedAtToUserCreateData(
      { id: 'user-1', email: 'ada@example.com' },
      { path: '/admin/create-user' }
    )).toEqual({
      data: {
        id: 'user-1',
        email: 'ada@example.com'
      }
    })
  })
})

function stubTermsConfig(options: { termsUrl?: string, markdownUrl?: string } = {}) {
  vi.stubGlobal('useRuntimeConfig', () => ({
    public: {
      legalTermsUrl: options.termsUrl ?? 'https://example.com/terms'
    },
    legalTermsMarkdownUrl: options.markdownUrl ?? ''
  }))
}
