import { Context, Data, Effect, Layer } from 'effect'
import type * as HttpClient from '@effect/platform/HttpClient'
import { LegalRepository, type LegalDocumentFetchError } from '../repositories/legal.repository'
import type { LegalDocument, LegalDocumentKind, LegalStatus } from '~~/shared/types/legal'

export class InvalidLegalDocumentSourceError extends Data.TaggedError('InvalidLegalDocumentSourceError')<{
  message: string
}> { }

export interface LegalServiceInterface {
  getDocument: (kind: LegalDocumentKind) => Effect.Effect<LegalDocument, LegalDocumentFetchError | InvalidLegalDocumentSourceError, HttpClient.HttpClient>
  getStatus: () => Effect.Effect<LegalStatus>
}

export class LegalService extends Context.Tag('LegalService')<LegalService, LegalServiceInterface>() { }

function configString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function markdownUrlFor(kind: LegalDocumentKind) {
  const config = useRuntimeConfig()
  if (kind === 'privacy') return configString(config.legalPrivacyPolicyMarkdownUrl)
  if (kind === 'terms') return configString(config.legalTermsMarkdownUrl)
  return configString(config.legalImprintMarkdownUrl)
}

function validateMarkdownUrl(url: string) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false
    }
    return true
  } catch {
    return false
  }
}

export const LegalServiceLive = Layer.effect(
  LegalService,
  Effect.gen(function* () {
    const legalRepository = yield* LegalRepository

    return {
      getStatus: () =>
        Effect.succeed({
          privacy: validateMarkdownUrl(markdownUrlFor('privacy')),
          imprint: validateMarkdownUrl(markdownUrlFor('imprint')),
          terms: validateMarkdownUrl(markdownUrlFor('terms'))
        } satisfies LegalStatus),

      getDocument: kind =>
        Effect.gen(function* () {
          const url = markdownUrlFor(kind)

          if (!url) {
            return {
              markdown: null,
              configured: false
            } satisfies LegalDocument
          }

          if (!validateMarkdownUrl(url)) {
            return yield* Effect.fail(new InvalidLegalDocumentSourceError({
              message: 'Configured legal Markdown URL must be an HTTP or HTTPS URL.'
            }))
          }

          const markdown = yield* legalRepository.fetchMarkdown(url)

          return {
            markdown,
            configured: true
          } satisfies LegalDocument
        })
    }
  })
)

export const getLegalDocument = (kind: LegalDocumentKind) =>
  Effect.flatMap(LegalService, service => service.getDocument(kind))

export const getLegalStatus = () =>
  Effect.flatMap(LegalService, service => service.getStatus())
