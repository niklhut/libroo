import { Context, Effect, Layer, Data, Duration } from 'effect'
import * as HttpClient from '@effect/platform/HttpClient'
import * as HCError from '@effect/platform/HttpClientError'
import type * as HttpClientType from '@effect/platform/HttpClient'
import { MAX_BULK_ISBN_COUNT } from '../../shared/utils/schemas'
import { DbService } from '../services/db.service'
import { putCoverImage, type StorageService } from '../services/storage.service'
import { DatabaseRateLimiter } from '../utils/database-rate-limiter'
import { runtimeProfile } from '../runtime/profile.active'

// Error types
export class OpenLibraryBookNotFoundError extends Data.TaggedError('OpenLibraryBookNotFoundError')<{
  isbn: string
  message?: string
}> { }

export class OpenLibraryApiError extends Data.TaggedError('OpenLibraryApiError')<{
  message: string
}> { }

export class OpenLibraryCoverError extends Data.TaggedError('OpenLibraryCoverError')<{
  message: string
  isbn: string
}> { }

// Types for OpenLibrary API response
export interface OpenLibraryBookData {
  title: string
  authors: string[]
  isbn: string
  openLibraryKey: string
  workKey: string | null
  coverUrl: string | null
  description?: string
  subjects?: string[]
  publishDate?: string
  publishers?: string[]
  numberOfPages?: number
}

// OpenLibrary API response format for /api/books endpoint
type OpenLibraryText = string | { type?: string, value?: unknown }

interface OpenLibraryBookDetails {
  title?: string
  authors?: Array<{ name: string, url?: string }>
  publishers?: Array<string | { name: string }>
  publish_date?: string
  number_of_pages?: number
  notes?: OpenLibraryText
  excerpts?: Array<{ text?: OpenLibraryText }>
  covers?: number[]
  key?: string
  subjects?: Array<string | { name: string, url?: string }>
  works?: Array<{ key: string }>
}

interface OpenLibraryBooksApiResponse {
  [key: string]: {
    details?: OpenLibraryBookDetails
    title?: string
    authors?: Array<{ name: string, url?: string }>
    publishers?: Array<{ name: string }>
    publish_date?: string
    number_of_pages?: number
    notes?: OpenLibraryText
    excerpts?: Array<{ text?: OpenLibraryText }>
    cover?: { small?: string, medium?: string, large?: string }
    key?: string
    subjects?: Array<{ name: string, url?: string }>
    thumbnail_url?: string
  }
}

// OpenLibrary Works API response
interface OpenLibraryWorksApiResponse {
  key: string
  title: string
  description?: OpenLibraryText
  subjects?: string[]
  subject_places?: string[]
  subject_times?: string[]
  covers?: number[]
}

// Service interface
export interface OpenLibraryRepositoryInterface {
  lookupByISBN: (isbn: string) => Effect.Effect<OpenLibraryBookData, OpenLibraryBookNotFoundError | OpenLibraryApiError, HttpClientType.HttpClient>
  lookupByISBNs: (isbns: string[]) => Effect.Effect<Map<string, OpenLibraryBookData>, OpenLibraryApiError, HttpClientType.HttpClient>
  downloadCover: (isbn: string, size?: 'S' | 'M' | 'L') => Effect.Effect<string | null, never, HttpClientType.HttpClient | StorageService>
  downloadCovers: (isbns: string[], size?: 'S' | 'M' | 'L') => Effect.Effect<Map<string, string | null>, never, HttpClientType.HttpClient | StorageService>
}

// Service tag
export class OpenLibraryRepository extends Context.Tag('OpenLibraryRepository')<
  OpenLibraryRepository,
  OpenLibraryRepositoryInterface
>() { }

// Normalize ISBN (remove dashes and spaces)
function normalizeISBN(isbn: string): string {
  return isbn.replace(/[-\s]/g, '')
}

const DEFAULT_OPEN_LIBRARY_TIMEOUT_SECONDS = 12
const DEFAULT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS = 20
const DEFAULT_OPEN_LIBRARY_API_BASE = 'https://openlibrary.org'
const DEFAULT_OPEN_LIBRARY_COVERS_BASE = 'https://covers.openlibrary.org'
const OPEN_LIBRARY_HTTP_CONCURRENCY = 16
const OPEN_LIBRARY_COVER_STORAGE_CONCURRENCY = 4
const MIN_ENRICHED_SUBJECT_COUNT = 5

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/\/+$/, '') : fallback
}

function getOpenLibraryApiBase() {
  return normalizeBaseUrl(process.env.LIBROO_OPENLIBRARY_API_BASE, DEFAULT_OPEN_LIBRARY_API_BASE)
}

function getOpenLibraryCoversBase() {
  return normalizeBaseUrl(process.env.LIBROO_OPENLIBRARY_COVERS_BASE, DEFAULT_OPEN_LIBRARY_COVERS_BASE)
}

function getOpenLibraryTimeout() {
  const config = useRuntimeConfig()
  const rawValue = config.openLibraryRequestTimeoutSeconds
  const seconds = typeof rawValue === 'number'
    ? rawValue
    : Number(String(rawValue ?? '').trim())

  return Duration.seconds(Number.isFinite(seconds) && seconds > 0
    ? seconds
    : DEFAULT_OPEN_LIBRARY_TIMEOUT_SECONDS)
}

function getOpenLibraryCoverTimeout() {
  const config = useRuntimeConfig()
  const rawValue = config.openLibraryCoverTimeoutSeconds
  const seconds = typeof rawValue === 'number'
    ? rawValue
    : Number(String(rawValue ?? '').trim())

  return Duration.seconds(Number.isFinite(seconds) && seconds > 0
    ? seconds
    : DEFAULT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS)
}

function getOpenLibraryContactEmail() {
  const config = useRuntimeConfig()
  const value = config.openLibraryContactEmail || process.env.NUXT_OPEN_LIBRARY_CONTACT_EMAIL
  return typeof value === 'string' ? value.trim() : ''
}

function getOpenLibraryHeaders() {
  const contact = getOpenLibraryContactEmail()
  return {
    'user-agent': contact ? `Libroo/0.2 (${contact})` : 'Libroo/0.2'
  }
}

function extractOpenLibraryText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const text = value.trim()
    return text || undefined
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return extractOpenLibraryText(value.value)
  }
  return undefined
}

// Helper to make HTTP GET request with timeout and get JSON response
const fetchJson = <T>(
  url: string,
  acquireSlot: Effect.Effect<void, OpenLibraryApiError>,
  operation: 'metadata' | 'work'
) =>
  Effect.gen(function* () {
    const slotStartedAt = Date.now()
    yield* acquireSlot
    yield* Effect.logDebug('Open Library outbound slot acquired').pipe(
      Effect.annotateLogs({ operation, waitDurationMs: Date.now() - slotStartedAt })
    )
    const requestStartedAt = Date.now()
    const response = yield* HttpClient.get(url, { headers: getOpenLibraryHeaders() }).pipe(
      Effect.timeout(getOpenLibraryTimeout()),
      Effect.mapError(error => new OpenLibraryApiError({
        message: `HTTP request failed: ${HCError.isHttpClientError(error) ? error.message : String(error)}`
      }))
    )
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(new OpenLibraryApiError({
        message: `Open Library returned HTTP ${response.status}`
      }))
    }
    const json = yield* response.json.pipe(
      Effect.mapError(error => new OpenLibraryApiError({
        message: `HTTP request failed: ${HCError.isHttpClientError(error) ? error.message : String(error)}`
      }))
    )
    yield* Effect.logDebug('Open Library request completed').pipe(
      Effect.annotateLogs({ operation, requestDurationMs: Date.now() - requestStartedAt })
    )
    return json as T
  })

// Live implementation
export const OpenLibraryRepositoryLive = Layer.effect(
  OpenLibraryRepository,
  Effect.gen(function* () {
    const dbService = yield* DbService
    // Cloudflare deployments coordinate through the shared database. A
    // self-hosted SQLite process must not write a rate-limit row between cover
    // storage and book persistence, so it uses one process-local pacing queue.
    const limiter = new DatabaseRateLimiter(dbService, Date.now, false)
    let localGate = Promise.resolve()
    let nextLocalRequestAt = 0

    const isSqliteBusy = (error: unknown) =>
      String(error).includes('SQLITE_BUSY') || String(error).includes('database is locked')

    const acquireDistributedSlotWithRetry = (attempt = 0): Effect.Effect<void, OpenLibraryApiError> => Effect.suspend(() =>
      Effect.tryPromise({
        try: () => limiter.consume('openlibrary:outbound', getOpenLibraryContactEmail() ? 3 : 1, 1),
        catch: error => new OpenLibraryApiError({ message: `Open Library rate limiter failed: ${String(error)}` })
      }).pipe(
        Effect.flatMap(result => result.allowed
          ? Effect.void
          : Effect.sleep(Duration.seconds(result.retryAfterSeconds)).pipe(
              Effect.flatMap(() => acquireDistributedSlotWithRetry())
            )),
        Effect.catchAll(error => isSqliteBusy(error.message) && attempt < 6
          ? Effect.sleep(Duration.millis(25 * 2 ** attempt)).pipe(
              Effect.flatMap(() => acquireDistributedSlotWithRetry(attempt + 1))
            )
          : Effect.fail(error))
      )
    )
    const acquireLocalSlot = Effect.promise(() => {
      const requestsPerSecond = getOpenLibraryContactEmail() ? 3 : 1
      const spacingMs = Math.ceil(1000 / requestsPerSecond)
      const slot = localGate.then(async () => {
        const waitMs = Math.max(0, nextLocalRequestAt - Date.now())
        if (waitMs > 0) await new Promise(resolve => setTimeout(resolve, waitMs))
        nextLocalRequestAt = Date.now() + spacingMs
      })
      localGate = slot.catch(() => {})
      return slot
    })
    const acquireSlot = runtimeProfile === 'selfhost'
      ? acquireLocalSlot
      : acquireDistributedSlotWithRetry()

    const lookupByISBNs = (isbns: string[]) =>
      Effect.gen(function* () {
        const normalized = [...new Set(isbns.map(normalizeISBN))]
        const booksByIsbn = new Map<string, OpenLibraryBookData>()
        const apiBase = getOpenLibraryApiBase()
        const coversBase = getOpenLibraryCoversBase()

        for (let start = 0; start < normalized.length; start += MAX_BULK_ISBN_COUNT) {
          const chunk = normalized.slice(start, start + MAX_BULK_ISBN_COUNT)
          const bibkeys = chunk.map(isbn => `ISBN:${isbn}`).join(',')
          const response = yield* fetchJson<OpenLibraryBooksApiResponse>(
            `${apiBase}/api/books?bibkeys=${bibkeys}&jscmd=details&format=json`,
            acquireSlot,
            'metadata'
          )

          for (const isbn of chunk) {
            const entry = response[`ISBN:${isbn}`]
            if (!entry) continue
            const details = entry.details ?? entry
            const authors = details.authors?.map(author => author.name).filter(Boolean) ?? []
            const publishers = details.publishers?.map(publisher => typeof publisher === 'string' ? publisher : publisher.name)
            const subjects = details.subjects
              ?.map(subject => typeof subject === 'string' ? subject : subject.name)
              .filter(subject => !subject.startsWith('nyt:'))
              .slice(0, 20)
            const workKey = 'works' in details ? details.works?.[0]?.key ?? null : null
            const hasCover = ('covers' in details && Boolean(details.covers?.length))
              || Boolean(entry.cover || entry.thumbnail_url)

            booksByIsbn.set(isbn, {
              title: details.title || 'Unknown Title',
              authors: authors.length > 0 ? authors : ['Unknown Author'],
              isbn,
              openLibraryKey: details.key || '',
              workKey,
              coverUrl: hasCover ? `${coversBase}/b/isbn/${isbn}-L.jpg?default=false` : null,
              description: extractOpenLibraryText(details.notes)
                ?? extractOpenLibraryText(details.excerpts?.[0]?.text),
              subjects,
              publishDate: details.publish_date,
              publishers,
              numberOfPages: details.number_of_pages
            })
          }
        }

        const booksNeedingWork = [...booksByIsbn.values()].filter(book =>
          Boolean(book.workKey)
          && (!book.description || (book.subjects?.length ?? 0) < MIN_ENRICHED_SUBJECT_COUNT)
        )
        const workKeys = [...new Set(booksNeedingWork.map(book => book.workKey).filter((key): key is string => Boolean(key)))]
        const workResults = yield* Effect.forEach(
          workKeys,
          key => fetchJson<OpenLibraryWorksApiResponse>(`${apiBase}${key}.json`, acquireSlot, 'work').pipe(
            Effect.map(data => [key, data] as const),
            Effect.catchAll(error => Effect.logDebug(`[OpenLibrary] Error fetching work ${key}: ${String(error)}`).pipe(
              Effect.as([key, null] as const)
            ))
          ),
          { concurrency: OPEN_LIBRARY_HTTP_CONCURRENCY }
        )
        const worksByKey = new Map(workResults)

        for (const [isbn, book] of booksByIsbn) {
          if (!book.workKey) continue
          const work = worksByKey.get(book.workKey)
          if (!work) continue
          const description = book.description || extractOpenLibraryText(work.description)
          const subjects = book.subjects && book.subjects.length >= MIN_ENRICHED_SUBJECT_COUNT
            ? book.subjects
            : [...new Set([...(book.subjects || []), ...(work.subjects || []).filter(subject => !subject.startsWith('nyt:'))])].slice(0, 20)
          booksByIsbn.set(isbn, { ...book, description, subjects })
        }

        return booksByIsbn
      })

    const fetchCoverImage = (isbn: string, size: 'S' | 'M' | 'L') =>
      Effect.gen(function* () {
        const normalizedISBN = normalizeISBN(isbn)
        const coverUrl = `${getOpenLibraryCoversBase()}/b/isbn/${normalizedISBN}-${size}.jpg?default=false`
        const slotStartedAt = Date.now()
        const acquired = yield* acquireSlot.pipe(
          Effect.as(true),
          Effect.catchAll(error =>
            Effect.logWarning(error.message).pipe(Effect.as(false))
          )
        )
        if (!acquired) return null
        yield* Effect.logDebug('Open Library outbound slot acquired').pipe(
          Effect.annotateLogs({ operation: 'cover', waitDurationMs: Date.now() - slotStartedAt })
        )

        const requestStartedAt = Date.now()
        const image = yield* HttpClient.get(coverUrl, { headers: getOpenLibraryHeaders() }).pipe(
          Effect.timeout(getOpenLibraryCoverTimeout()),
          Effect.flatMap((response) => {
            if (response.status < 200 || response.status >= 300) {
              return Effect.succeed(null as ArrayBuffer | null)
            }

            const contentLength = response.headers['content-length']
            if (contentLength && parseInt(contentLength) < 1000) {
              return Effect.succeed(null as ArrayBuffer | null)
            }

            return response.arrayBuffer
          }),
          Effect.mapError(error => new OpenLibraryCoverError({
            message: `Failed to fetch cover: ${HCError.isHttpClientError(error) ? error.message : String(error)}`,
            isbn: normalizedISBN
          })),
          Effect.catchAll(error =>
            Effect.logWarning(`Cover download failed for ISBN ${error.isbn}: ${error.message}`).pipe(
              Effect.as(null as ArrayBuffer | null)
            )
          )
        )
        yield* Effect.logDebug('Open Library request completed').pipe(
          Effect.annotateLogs({ operation: 'cover', requestDurationMs: Date.now() - requestStartedAt })
        )
        return image
      })

    const downloadCovers = (isbns: string[], size: 'S' | 'M' | 'L' = 'L') =>
      Effect.gen(function* () {
        const normalized = [...new Set(isbns.map(normalizeISBN))]
        const storageSemaphore = yield* Effect.makeSemaphore(OPEN_LIBRARY_COVER_STORAGE_CONCURRENCY)
        const results = yield* Effect.forEach(
          normalized,
          isbn => Effect.gen(function* () {
            const imageBuffer = yield* fetchCoverImage(isbn, size)
            if (!imageBuffer) {
              yield* Effect.log(`[OpenLibrary] No cover found for ISBN ${isbn}`)
              return [isbn, null] as const
            }

            const pathname = `covers/${isbn}.webp`
            const coverPath = yield* storageSemaphore.withPermits(1)(
              putCoverImage(pathname, imageBuffer).pipe(
                Effect.map(blobMetadata => blobMetadata.pathname),
                Effect.catchAll(error =>
                  Effect.logWarning(`Failed to store cover in blob storage: ${error}`).pipe(
                    Effect.as(null)
                  )
                )
              )
            )
            return [isbn, coverPath] as const
          }),
          { concurrency: OPEN_LIBRARY_HTTP_CONCURRENCY }
        )
        return new Map(results)
      })

    return {
      lookupByISBNs,
      lookupByISBN: isbn =>
        Effect.gen(function* () {
          const normalizedISBN = normalizeISBN(isbn)
          const books = yield* lookupByISBNs([normalizedISBN])
          const book = books.get(normalizedISBN)
          if (book) return book
          return yield* Effect.fail(new OpenLibraryBookNotFoundError({
            isbn: normalizedISBN,
            message: `Book with ISBN ${normalizedISBN} not found`
          }))
        }),

      downloadCovers,
      downloadCover: (isbn, size = 'L') =>
        downloadCovers([isbn], size).pipe(
          Effect.map(covers => covers.get(normalizeISBN(isbn)) ?? null)
        )
    }
  })
)

// Helper effects
export const lookupByISBN = (isbn: string) =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.lookupByISBN(isbn))

export const lookupByISBNs = (isbns: string[]) =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.lookupByISBNs(isbns))

export const downloadCover = (isbn: string, size?: 'S' | 'M' | 'L') =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.downloadCover(isbn, size))

export const downloadCovers = (isbns: string[], size?: 'S' | 'M' | 'L') =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.downloadCovers(isbns, size))
