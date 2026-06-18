import { Context, Data, Duration, Effect, Layer } from 'effect'
import * as HttpClient from '@effect/platform/HttpClient'
import * as HCError from '@effect/platform/HttpClientError'
import type * as HttpClientType from '@effect/platform/HttpClient'

const maxLegalDocumentBytes = 256 * 1024

export class LegalDocumentFetchError extends Data.TaggedError('LegalDocumentFetchError')<{
  message: string
}> { }

export interface LegalRepositoryInterface {
  fetchMarkdown: (url: string) => Effect.Effect<string, LegalDocumentFetchError, HttpClientType.HttpClient>
}

export class LegalRepository extends Context.Tag('LegalRepository')<LegalRepository, LegalRepositoryInterface>() { }

function isLegalDocumentFetchError(error: unknown): error is LegalDocumentFetchError {
  return Boolean(error && typeof error === 'object' && '_tag' in error && error._tag === 'LegalDocumentFetchError')
}

function legalDocumentFetchError(message: string) {
  return new LegalDocumentFetchError({ message })
}

export const LegalRepositoryLive = Layer.succeed(LegalRepository, {
  fetchMarkdown: url =>
    HttpClient.get(url, {
      accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1'
    }).pipe(
      Effect.flatMap((response) => {
        if (response.status < 200 || response.status >= 300) {
          return Effect.fail(legalDocumentFetchError(`Markdown source responded with ${response.status}.`))
        }

        const contentLength = response.headers['content-length']
        if (contentLength && Number(contentLength) > maxLegalDocumentBytes) {
          return Effect.fail(legalDocumentFetchError('Markdown source is too large.'))
        }

        return response.text.pipe(
          Effect.flatMap((markdown) => {
            if (new TextEncoder().encode(markdown).byteLength > maxLegalDocumentBytes) {
              return Effect.fail(legalDocumentFetchError('Markdown source is too large.'))
            }

            return Effect.succeed(markdown)
          })
        )
      }),
      Effect.timeout(Duration.seconds(5)),
      Effect.mapError((error) => {
        if (isLegalDocumentFetchError(error)) {
          return error
        }

        return new LegalDocumentFetchError({
          message: `Failed to fetch configured legal Markdown: ${HCError.isHttpClientError(error) ? error.message : String(error)}`
        })
      })
    )
})
