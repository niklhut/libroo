import { Effect, Layer } from 'effect'
import * as FetchHttpClient from '@effect/platform/FetchHttpClient'
import type * as HttpClient from '@effect/platform/HttpClient'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OpenLibraryRepository,
  OpenLibraryRepositoryLive
} from '../../server/repositories/openLibrary.repository'
import { DbService } from '../../server/services/db.service'

// These ISBN-10 and ISBN-13 identifiers point to the same known edition. The
// live request guards the single, bulk, and enrichment fallback paths against
// changes to Open Library's public API or its query behavior.
const ISBN_13 = '9780140328721'
const ISBN_10 = '0140328726'
const EXPECTED_EDITION_KEY = '/books/OL7353617M'

describe('Open Library live API integration', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('returns the matching edition from single and batch ISBN lookups', { retry: 2, timeout: 120_000 }, async () => {
    vi.stubEnv('LIBROO_OPENLIBRARY_API_BASE', 'https://openlibrary.org')
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 20,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))

    const run = <A>(effect: Effect.Effect<A, unknown, OpenLibraryRepository | HttpClient.HttpClient | DbService>) =>
      Effect.runPromise(effect.pipe(
        Effect.provide(OpenLibraryRepositoryLive),
        Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
        Effect.provide(FetchHttpClient.layer)
      ))

    const single = await run(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupCoreByISBN(ISBN_13)
    ))
    expect(single).toMatchObject({
      isbn: ISBN_13,
      openLibraryKey: EXPECTED_EDITION_KEY,
      title: 'Fantastic Mr. Fox',
      authors: ['Roald Dahl']
    })

    const coreBatch = await run(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupCoreByISBNs([ISBN_13, ISBN_10])
    ))
    expect(coreBatch.size).toBe(2)
    expect(coreBatch.get(ISBN_13)).toMatchObject({ isbn: ISBN_13, openLibraryKey: EXPECTED_EDITION_KEY })
    expect(coreBatch.get(ISBN_10)).toMatchObject({ isbn: ISBN_10, openLibraryKey: EXPECTED_EDITION_KEY })

    const enrichedBatch = await run(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupByISBNs([ISBN_13, ISBN_10])
    ))
    expect(enrichedBatch.size).toBe(2)
    expect(enrichedBatch.get(ISBN_13)).toMatchObject({ isbn: ISBN_13, openLibraryKey: EXPECTED_EDITION_KEY })
    expect(enrichedBatch.get(ISBN_10)).toMatchObject({ isbn: ISBN_10, openLibraryKey: EXPECTED_EDITION_KEY })
  })
})
