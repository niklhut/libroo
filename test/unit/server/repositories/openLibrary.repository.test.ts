import { Effect, Either, Layer } from 'effect'
import * as HttpClient from '@effect/platform/HttpClient'
import * as HttpClientResponse from '@effect/platform/HttpClientResponse'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OpenLibraryRepository,
  OpenLibraryRepositoryLive
} from '../../../../server/repositories/openLibrary.repository'
import { DbService } from '../../../../server/services/db.service'
import { StorageService } from '../../../../server/services/storage.service'

describe('OpenLibraryRepository details lookup', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('uses jscmd=details for single and batch lookup without edition requests', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const requestedUrls: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      const url = new URL(request.url)
      const bibkeys = url.searchParams.get('bibkeys')?.split(',') ?? []
      const response = Object.fromEntries(bibkeys.map((bibkey, index) => [bibkey, {
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
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(response))))
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
    expect(requestedUrls.every(url => url.includes('jscmd=details'))).toBe(true)
    expect(requestedUrls[1]).toContain('bibkeys=ISBN:9780306406157,ISBN:9780141439518')
    expect(requestedUrls.some(url => /\/books\/[^?]+\.json/.test(url))).toBe(false)
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
      expect(result.left).toMatchObject({
        _tag: 'OpenLibraryApiError',
        message: 'Open Library returned HTTP 429'
      })
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
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({
        'ISBN:9780306406157': {
          details: { key: '/books/OL1M', title: 'Identified', authors: [{ name: 'Author' }], works: [] }
        }
      }))))
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
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(response))))
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

  it('skips work enrichment when embedded details already contain a description and enough subjects', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({
      openLibraryRequestTimeoutSeconds: 12,
      openLibraryCoverTimeoutSeconds: 20,
      openLibraryContactEmail: ''
    }))
    const requestedUrls: string[] = []
    const httpClient = HttpClient.make((request) => {
      requestedUrls.push(request.url)
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({
        'ISBN:9780306406157': {
          details: {
            key: '/books/OL1M',
            title: 'Complete',
            authors: [{ name: 'Author' }],
            notes: 'Edition description',
            subjects: ['One', 'Two', 'Three', 'Four', 'Five'],
            works: [{ key: '/works/OL1W' }]
          }
        }
      }))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository =>
      repository.lookupByISBN('9780306406157')
    ).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(result.description).toBe('Edition description')
    expect(result.subjects).toHaveLength(5)
    expect(requestedUrls).toHaveLength(1)
    expect(requestedUrls[0]).toContain('jscmd=details')
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
        return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify({
          'ISBN:9780306406157': { details: { key: '/books/OL1M', title: 'First', works: [{ key: '/works/OL1W' }] } },
          'ISBN:9780141439518': { details: { key: '/books/OL2M', title: 'Second', works: [{ key: '/works/OL2W' }] } }
        }))))
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
    expect(maxActiveStorage).toBe(4)
  })

  it('normalizes object-shaped edition notes and work descriptions to text', async () => {
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
                works: []
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
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(JSON.stringify(response))))
    })

    const result = await Effect.runPromise(Effect.flatMap(OpenLibraryRepository, repository => repository.lookupByISBNs([
      '9780306406157',
      '9780141439518'
    ])).pipe(
      Effect.provide(OpenLibraryRepositoryLive),
      Effect.provide(Layer.succeed(DbService, { executeAtomic: vi.fn() } as never)),
      Effect.provide(Layer.succeed(HttpClient.HttpClient, httpClient))
    ))

    expect(result.get('9780306406157')?.description).toBe('Structured edition notes')
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
      new Response(JSON.stringify({
        'ISBN:9780306406157': {
          details: { key: '/books/OL1M', title: 'Recovered', authors: [{ name: 'Author' }], works: [] }
        }
      }))
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
})
