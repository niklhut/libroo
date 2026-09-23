import { Effect, Either, Layer } from 'effect'
import * as HttpClient from '@effect/platform/HttpClient'
import * as HttpClientResponse from '@effect/platform/HttpClientResponse'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPEN_LIBRARY_COVER_STORAGE_CONCURRENCY,
  OpenLibraryBookNotFoundError,
  OpenLibraryRepository,
  OpenLibraryRepositoryLive
} from '../../../../server/repositories/openLibrary.repository'
import { DbService } from '../../../../server/services/db.service'
import { StorageService } from '../../../../server/services/storage.service'

interface LegacyBookDetails {
  details?: LegacyBookDetails
  key?: string
  title?: string
  authors?: Array<{ name?: string }>
  works?: Array<{ key: string }>
  subjects?: string[]
  covers?: number[]
  publishers?: string[]
  publish_date?: string
  number_of_pages?: number
}

function toSearchResponse(url: string, response: object) {
  if (Array.isArray((response as { docs?: unknown }).docs)) return response
  const legacyResponse = response as Record<string, LegacyBookDetails>
  const requestedIsbns = [...(new URL(url).searchParams.get('q') ?? '').matchAll(/\d{10,13}/g)].map(match => match[0])
  if (requestedIsbns.length === 0) return response
  return {
    docs: requestedIsbns.flatMap((isbn, index) => {
      const entry = legacyResponse[`ISBN:${isbn}`]
      if (!entry) return []
      const details = entry.details ?? entry
      const workKey = details.works?.[0]?.key ?? (details.works?.length === 0 ? undefined : `/works/OL${index + 1}W`)
      const key = details.key ?? `/books/OL${index + 1}M`
      return [{
        key: workKey,
        title: details.title,
        author_name: details.authors?.map((author: { name?: string }) => author.name).filter(Boolean),
        isbn: [isbn],
        subject: details.subjects,
        editions: { docs: [{
          key,
          title: details.title,
          author_name: details.authors?.map((author: { name?: string }) => author.name).filter(Boolean),
          isbn: [isbn],
          cover_i: details.covers?.[0],
          publisher: details.publishers,
          publish_date: details.publish_date ? [details.publish_date] : undefined,
          number_of_pages: details.number_of_pages,
          subject: details.subjects
        }] }
      }]
    })
  }
}

describe('OpenLibraryRepository details lookup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('uses one ISBN Search API request for the interactive core lookup', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const requestedUrls: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({
        docs: [{
          key: 'OL1W',
          title: 'Work-level title',
          author_name: ['Work-level author'],
          edition_key: ['OL-WRONGM'],
          cover_i: 1,
          publisher: ['Work-level publisher'],
          publish_date: ['Work-level date'],
          number_of_pages_median: 999,
          isbn: ['0140328726', '9780140328721'],
          editions: {
            docs: [
              {
                key: '/books/OL-WRONGM',
                title: 'Wrong edition',
                isbn: ['9780000000000'],
                cover_i: 2,
                publisher: ['Wrong publisher'],
                publish_date: ['Wrong date'],
                number_of_pages: 100
              },
              {
                key: '/books/OL7353617M',
                title: 'Fantastic Mr. Fox',
                author_name: ['Roald Dahl'],
                isbn: ['0140328726', '9780140328721'],
                cover_i: 15152634,
                publisher: ['Puffin'],
                publish_date: ['October 1, 1988'],
                number_of_pages: 96
              }
            ]
          }
        }]
      }))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupCoreByISBN('978-0-14-032872-1')
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(requestedUrls).toHaveLength(1)
    const requestUrl = new URL(requestedUrls[0]!)
    expect(requestUrl.pathname).toBe('/search.json')
    expect(requestUrl.searchParams.get('q')).toBe('isbn:(9780140328721)')
    expect(requestUrl.searchParams.get('fields')).toContain('editions.isbn')
    expect(result).toMatchObject({
      title: 'Fantastic Mr. Fox',
      authors: ['Roald Dahl'],
      isbn: '9780140328721',
      openLibraryKey: '/books/OL7353617M',
      workKey: '/works/OL1W',
      publishDate: 'October 1, 1988',
      publishers: ['Puffin'],
      numberOfPages: 96,
      coverUrl: 'https://covers.openlibrary.org/b/id/15152634-L.jpg?default=false'
    })
  })

  it('falls back to the ISBN edition endpoint when Search omits its matching edition', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const requestedUrls: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      const url = new URL(request.url)
      const response = url.pathname === '/search.json'
        ? {
            docs: [{
              key: '/works/OL1W',
              title: 'Work title',
              isbn: ['9780306406157'],
              editions: { docs: [{ key: '/books/OL-WRONGM', title: 'Wrong edition', isbn: ['9780000000000'] }] }
            }]
          }
        : {
            key: '/books/OL1M',
            title: 'Matching ISBN edition',
            authors: [{ name: 'Edition Author' }],
            works: [{ key: 'OL1W' }],
            covers: [42],
            publishers: ['Edition Press'],
            publish_date: '2002',
            number_of_pages: 123,
            description: 'Edition description',
            notes: 'Edition notes',
            subjects: ['Subject']
          }
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(response))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupCoreByISBN('9780306406157')
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(requestedUrls.map(url => new URL(url).pathname)).toEqual(['/search.json', '/isbn/9780306406157.json'])
    expect(result).toMatchObject({
      title: 'Matching ISBN edition',
      authors: ['Edition Author'],
      isbn: '9780306406157',
      openLibraryKey: '/books/OL1M',
      workKey: '/works/OL1W',
      coverUrl: 'https://covers.openlibrary.org/b/id/42-L.jpg?default=false',
      publishers: ['Edition Press'],
      publishDate: '2002',
      numberOfPages: 123,
      description: 'Edition description'
    })
  })

  it('does not call the ISBN endpoint when Search has no matching ISBN', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const requestedUrls: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({
        docs: [{ isbn: ['9780000000000'], editions: { docs: [{ isbn: ['9780000000000'] }] } }]
      }))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupCoreByISBN('9780306406157').pipe(Effect.either)
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) expect(result.left).toBeInstanceOf(OpenLibraryBookNotFoundError)
    expect(requestedUrls.map(url => new URL(url).pathname)).toEqual(['/search.json'])
  })

  it('ignores malformed array fields in an ISBN edition response', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const httpClient = HttpClient.make((request) => {
      const url = new URL(request.url)
      const response = url.pathname === '/search.json'
        ? { docs: [{ isbn: ['9780306406157'], editions: { docs: [{ isbn: ['9780000000000'] }] } }] }
        : {
            key: '/books/OL1M', title: 'Matching edition', authors: [{ name: 'Author' }],
            covers: { invalid: true }, publishers: { invalid: true }, subjects: 'invalid'
          }
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(response))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupCoreByISBN('9780306406157')
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(result).toMatchObject({
      title: 'Matching edition',
      authors: ['Author'],
      coverUrl: null,
      subjects: [],
      publishers: []
    })
  })

  it('uses the Search API for single and batch lookup without edition requests', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const requestedUrls: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      const url = new URL(request.url)
      const isbns = [...(url.searchParams.get('q') ?? '').matchAll(/\d{10,13}/g)].map(match => match[0])
      const response = Object.fromEntries(isbns.map((isbn, index) => [`ISBN:${isbn}`, {
        details: {
          key: `/books/OL${index + 1}M`,
          title: `Book ${index + 1}`,
          authors: [{ name: `Author ${index + 1}` }],
          publishers: ['Publisher'],
          publish_date: '2026',
          number_of_pages: 123,
          covers: [1],
          works: []
        }
      }]))
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(toSearchResponse(request.url, response)))))
    })
    const executeAtomic = vi.fn(async () => [[{ count: 1, windowStart: Date.now() }]])
    const dbLayer = Layer.succeed(DbService, { executeAtomic } as never)
    const httpLayer = Layer.succeed(HttpClient.HttpClient, httpClient)

    const run = <A>(effect: Effect.Effect<A, unknown, OpenLibraryRepository | HttpClient.HttpClient | DbService>) =>
      Effect.runPromise(effect.pipe(
        Effect.provide(OpenLibraryRepositoryLive),
        Effect.provide(dbLayer),
        Effect.provide(httpLayer)
      ))

    const single = await run(Effect.flatMap(OpenLibraryRepository, repository => repository.lookupByISBN('9780306406157')))
    const batch = await run(Effect.flatMap(OpenLibraryRepository, repository => repository.lookupByISBNs([
      '9780306406157',
      '9780141439518'
    ])))

    expect(single.openLibraryKey).toBe('/books/OL1M')
    expect(batch.size).toBe(2)
    expect(requestedUrls).toHaveLength(2)
    expect(requestedUrls.every(url => new URL(url).pathname === '/search.json')).toBe(true)
    expect(new URL(requestedUrls[1]!).searchParams.get('q')).toBe('isbn:(9780306406157 OR 9780141439518)')
    expect(requestedUrls.some(url => /\/books\/[^?]+\.json/.test(url))).toBe(false)
  })

  it('core batch lookup deduplicates ISBNs and avoids optional enrichment requests', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const requestedUrls: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      const response = {
        'ISBN:9780306406157': {
          details: {
            key: '/books/OL1M', title: 'Dune', authors: [{ name: 'Author' }],
            works: [{ key: '/works/OL1W' }]
          }
        }
      }
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(toSearchResponse(request.url, response)))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupCoreByISBNs(['9780306406157', '9780306406157', '9780141439518'])
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(result.size).toBe(1)
    expect(result.get('9780306406157')).toMatchObject({ title: 'Dune', authors: ['Author'] })
    expect(requestedUrls).toHaveLength(1)
    expect(new URL(requestedUrls[0]!).searchParams.get('q')).toBe('isbn:(9780306406157 OR 9780141439518)')
    expect(requestedUrls.every(url => new URL(url).pathname === '/search.json')).toBe(true)
  })

  it('resolves additional ISBN editions of a work individually instead of reusing the first edition', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: 'operator@example.com'
    }))
    const requestedUrls: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      const query = new URL(request.url).searchParams.get('q') ?? ''
      const isSecondISBN = query.includes('9780141439518') && !query.includes(' OR ')
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({
        docs: [{
          key: '/works/OL1W',
          title: 'Shared work',
          isbn: ['9780306406157', '9780141439518'],
          editions: { docs: [isSecondISBN
            ? { key: '/books/OL2M', title: 'Second edition', isbn: ['9780141439518'] }
            : { key: '/books/OL1M', title: 'First edition', isbn: ['9780306406157'] }
          ] }
        }]
      }))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupCoreByISBNs(['9780306406157', '9780141439518'])
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(requestedUrls).toHaveLength(2)
    expect(result.get('9780306406157')).toMatchObject({ title: 'First edition', openLibraryKey: '/books/OL1M' })
    expect(result.get('9780141439518')).toMatchObject({ title: 'Second edition', openLibraryKey: '/books/OL2M' })
  })

  it('retries every unmapped ISBN when a Search API page is full', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const requestedUrls: string[] = []
    const targetIsbns = ['9780306406157', '9780141439518']
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      const query = new URL(request.url).searchParams.get('q') ?? ''
      const isbns = [...query.matchAll(/\d{10,13}/g)].map(match => match[0]!)
      const docs = query.includes(' OR ')
        ? Array.from({ length: 10 }, (_, index) => ({ isbn: [`999999999${index}`] }))
        : [{
            isbn: isbns,
            editions: { docs: [{ title: `Book ${isbns[0]}`, isbn: isbns }] }
          }]
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ docs }))))
    })
    const provide = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient | typeof OpenLibraryRepository>) => effect.pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    )

    const enrichedResult = await Effect.runPromise(provide(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupByISBNs(targetIsbns)
    )))
    expect(enrichedResult.size).toBe(2)
    expect(requestedUrls).toHaveLength(3)
    expect(requestedUrls.slice(1).map(url => new URL(url).searchParams.get('q'))).toEqual(
      targetIsbns.map(isbn => `isbn:(${isbn})`)
    )

    requestedUrls.length = 0
    const coreResult = await Effect.runPromise(provide(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupCoreByISBNs(targetIsbns)
    )))
    expect(coreResult.size).toBe(2)
    expect(requestedUrls).toHaveLength(3)
    expect(requestedUrls.slice(1).map(url => new URL(url).searchParams.get('q'))).toEqual(
      targetIsbns.map(isbn => `isbn:(${isbn})`)
    )
  }, 30_000)

  it('uses Search API authors from the matching edition', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const requestedUrls: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      const response = {
        'ISBN:9780141439518': {
          details: { key: '/books/OL2M', title: 'Pride and Prejudice', authors: [{ name: 'Jane Austen' }], works: [] }
        }
      }
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(toSearchResponse(request.url, response)))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupByISBN('9780141439518')
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(result.authors).toEqual(['Jane Austen'])
    expect(requestedUrls).toHaveLength(1)
    expect(new URL(requestedUrls[0]!).searchParams.get('q')).toBe('isbn:(9780141439518)')
  })

  it('rejects non-success metadata responses before parsing their JSON body', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const httpClient = HttpClient.make(request => Effect.succeed(HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 })
    )))

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupByISBNs(['9780306406157'])
    ).pipe(
      Effect.either,
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe('OpenLibraryApiError')
      expect(result.left.message).toBe('Open Library returned HTTP 429 for /search.json')
      expect(result.left.status).toBe(429)
    }
  })

  it('uses the runtime contact secret to identify Worker requests', async () => {
    vi.stubEnv('NUXT_OPEN_LIBRARY_CONTACT_EMAIL', 'worker-operator@example.com')
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    let userAgent = ''
    const httpClient = HttpClient.make((request) => {
      userAgent = request.headers['user-agent'] ?? ''
      const response = {
        'ISBN:9780306406157': {
          details: { key: '/books/OL1M', title: 'Identified', authors: [{ name: 'Author' }], works: [] }
        }
      }
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(toSearchResponse(request.url, response)))))
    })

    await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupByISBN('9780306406157')
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(userAgent).toContain('worker-operator@example.com')
  })

  it('deduplicates work enrichment and merges its description and subjects', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: 'operator@example.com'
    }))
    const requestedUrls: string[] = []
    const userAgents: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      userAgents.push(request.headers['user-agent'] ?? '')
      const response = request.url.includes('/works/OL1W.json')
        ? { key: '/works/OL1W', title: 'Work', description: 'Work description', subjects: ['Work subject'] }
        : {
            'ISBN:9780306406157': { details: { key: '/books/OL1M', title: 'First', authors: [{ name: 'Author' }], works: [{ key: '/works/OL1W' }] } },
            'ISBN:9780141439518': { details: { key: '/books/OL2M', title: 'Second', authors: [{ name: 'Author' }], works: [{ key: '/works/OL1W' }] } }
          }
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(toSearchResponse(request.url, response)))))
    })
    const dbLayer = Layer.succeed(DbService, {
      executeAtomic: vi.fn(async () => [[{ count: 1, windowStart: Date.now() }]])
    } as never)

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository => repository.lookupByISBNs([
      '9780306406157',
      '9780141439518'
    ])).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(dbLayer),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(requestedUrls.filter(url => url.includes('/works/OL1W.json'))).toHaveLength(1)
    expect(userAgents.every(value => value.includes('operator@example.com'))).toBe(true)
    expect(result.get('9780306406157')).toMatchObject({ description: 'Work description', subjects: ['Work subject'] })
    expect(result.get('9780141439518')).toMatchObject({ description: 'Work description', subjects: ['Work subject'] })
  })

  it('hydrates work descriptions while retaining Search API subjects', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const requestedUrls: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      const response = request.url.includes('/works/OL1W.json')
        ? { key: '/works/OL1W', title: 'Complete', description: 'Work description', subjects: ['One', 'Two', 'Three', 'Four', 'Five'] }
        : {
            'ISBN:9780306406157': {
              details: {
                key: '/books/OL1M', title: 'Complete', authors: [{ name: 'Author' }],
                subjects: ['One', 'Two', 'Three', 'Four', 'Five'], works: [{ key: '/works/OL1W' }]
              }
            }
          }
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(toSearchResponse(request.url, response)))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupByISBN('9780306406157')
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(result.description).toBe('Work description')
    expect(result.subjects).toHaveLength(5)
    expect(requestedUrls).toHaveLength(2)
    expect(new URL(requestedUrls[0]!).searchParams.get('q')).toContain('isbn:')
  })

  it('starts later work requests when pacing permits without waiting for earlier responses', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: 'operator@example.com'
    }))
    let startedWorks = 0
    const resolveWorks: Array<() => void> = []
    const httpClient = HttpClient.make((request) => {
      if (!request.url.includes('/works/')) {
        const response = {
          'ISBN:9780306406157': { details: { key: '/books/OL1M', title: 'First', works: [{ key: '/works/OL1W' }] } },
          'ISBN:9780141439518': { details: { key: '/books/OL2M', title: 'Second', works: [{ key: '/works/OL2W' }] } }
        }
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(toSearchResponse(request.url, response)))))
      }

      startedWorks += 1
      return Effect.promise(() => new Promise((resolve) => {
        resolveWorks.push(() => resolve(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({
          key: request.url.includes('OL1W') ? '/works/OL1W' : '/works/OL2W',
          title: 'Work',
          description: 'Description'
        })))))
      }))
    })

    const lookup = Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository => repository.lookupByISBNs([
      '9780306406157',
      '9780141439518'
    ])).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    await vi.waitFor(() => expect(startedWorks).toBe(2), { timeout: 2000 })
    resolveWorks.forEach(resolve => resolve())
    await lookup
  })

  it('limits concurrent cover conversion and storage while cover HTTP requests overlap', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: 'operator@example.com'
    }))
    const isbns = Array.from({ length: 6 }, (_, index) => `97803064061${index}`)
    const resolveCovers: Array<() => void> = []
    let startedCovers = 0
    let activeStorage = 0
    let maxActiveStorage = 0
    const httpClient = HttpClient.make(request => Effect.promise(() => new Promise((resolve) => {
      startedCovers += 1
      resolveCovers.push(() => resolve(HttpClientResponse.fromWeb(
        request,
        new Response(new Uint8Array(1200), { headers: { 'content-length': '1200' } })
      )))
    })))
    const storage = {
      putCoverImage: vi.fn((pathname: string) => Effect.promise(async () => {
        activeStorage += 1
        maxActiveStorage = Math.max(maxActiveStorage, activeStorage)
        await new Promise(resolve => setTimeout(resolve, 20))
        activeStorage -= 1
        return { pathname, uploadedAt: new Date() }
      }))
    }

    const covers = Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository => repository.downloadCovers(isbns)).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient)),
      Effect.provide(Layer.succeed(StorageService, storage as never))
    ))

    await vi.waitFor(() => expect(startedCovers).toBe(isbns.length), { timeout: 3000 })
    resolveCovers.forEach(resolve => resolve())
    const result = await covers

    expect(result.size).toBe(isbns.length)
    expect(maxActiveStorage).toBe(OPEN_LIBRARY_COVER_STORAGE_CONCURRENCY)
  })

  it('normalizes object-shaped work descriptions to text', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const httpClient = HttpClient.make((request) => {
      const response = request.url.includes('/works/OL1W.json')
        ? {
            key: '/works/OL1W',
            title: 'Work',
            description: { type: '/type/text', value: 'Structured work description' }
          }
        : {
            'ISBN:9780306406157': {
              details: {
                key: '/books/OL1M',
                title: 'First',
                authors: [{ name: 'Author' }],
                notes: { type: '/type/text', value: 'Structured edition notes' },
                works: [{ key: '/works/OL1W' }]
              }
            },
            'ISBN:9780141439518': {
              details: {
                key: '/books/OL2M',
                title: 'Second',
                authors: [{ name: 'Author' }],
                works: [{ key: '/works/OL1W' }]
              }
            }
          }
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(toSearchResponse(request.url, response)))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository => repository.lookupByISBNs([
      '9780306406157',
      '9780141439518'
    ])).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(result.get('9780306406157')?.description).toBe('Structured work description')
    expect(result.get('9780141439518')?.description).toBe('Structured work description')
    expect(typeof result.get('9780306406157')?.description).toBe('string')
    expect(typeof result.get('9780141439518')?.description).toBe('string')
  })

  it('does not write outbound pacing counters to self-hosted SQLite', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const executeAtomic = vi.fn(async () => {
      throw new Error('The self-hosted outbound gate must not use SQLite')
    })
    const httpClient = HttpClient.make(request => Effect.succeed(HttpClientResponse.fromWeb(
      request,
      new Response(JSON.stringify(toSearchResponse(request.url, {
        'ISBN:9780306406157': {
          details: { key: '/books/OL1M', title: 'Recovered', authors: [{ name: 'Author' }], works: [] }
        }
      })))
    )))

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupByISBN('9780306406157')
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(result.title).toBe('Recovered')
    expect(executeAtomic).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('enriches a persisted seed without repeating the edition details request', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openLibraryRequestTimeoutSeconds: 12, openLibraryCoverTimeoutSeconds: 20, openLibraryContactEmail: '' }))
    const urls: string[] = []
    const httpClient = HttpClient.make((request) => {
      urls.push(request.url)
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({ key: '/works/OL1W', title: 'Work', subjects: ['one'] }))))
    })
    const seed = { title: 'Seed', authors: ['Author'], isbn: '9780306406157', openLibraryKey: '/books/OL1M', workKey: '/works/OL1W', coverUrl: 'https://covers.openlibrary.org/b/id/42-L.jpg?default=false', subjects: ['one'], description: 'Ready' }
    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repo => repo.enrichMetadata(seed)).pipe(Effect.provide(OpenLibraryRepositoryLive), Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)), Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))))
    expect(result.title).toBe('Seed')
    expect(urls.every(url => !url.includes('/api/books'))).toBe(true)
  })

  it('keeps persisted metadata when optional work enrichment fails', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openLibraryRequestTimeoutSeconds: 12, openLibraryCoverTimeoutSeconds: 20, openLibraryContactEmail: '' }))
    const httpClient = HttpClient.make(request => Effect.succeed(HttpClientResponse.fromWeb(request, new Response('failure', { status: 503 }))))
    const seed = { title: 'Seed', authors: ['Author'], isbn: '9780306406157', openLibraryKey: '/books/OL1M', workKey: '/works/OL1W', coverUrl: null, subjects: [], description: undefined }
    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repo => repo.enrichMetadata(seed)).pipe(Effect.provide(OpenLibraryRepositoryLive), Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)), Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))))
    expect(result.title).toBe('Seed')
    expect(result.authors).toEqual(['Author'])
  })

  it('keeps enrichment moving when the optional ISBN author lookup fails', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ openLibraryRequestTimeoutSeconds: 12, openLibraryCoverTimeoutSeconds: 20, openLibraryContactEmail: '' }))
    const urls: string[] = []
    const httpClient = HttpClient.make((request) => {
      urls.push(request.url)
      if (new URL(request.url).pathname.startsWith('/isbn/')) {
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response('missing edition', { status: 404 })))
      }
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({
        key: '/works/OL1W',
        title: 'Work',
        description: 'Recovered description',
        subjects: ['one', 'two', 'three', 'four', 'five']
      }))))
    })
    const seed = {
      title: 'Seed', authors: ['Unknown Author'], isbn: '9780306406157', openLibraryKey: '/books/OL1M',
      workKey: '/works/OL1W', coverUrl: null, subjects: [], description: undefined
    }

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repo => repo.enrichMetadata(seed)).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(result.authors).toEqual(['Unknown Author'])
    expect(result.description).toBe('Recovered description')
    expect(urls.map(url => new URL(url).pathname)).toEqual(['/isbn/9780306406157.json', '/works/OL1W.json'])
  }, 30_000)
})
