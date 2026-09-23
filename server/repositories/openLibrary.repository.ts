import { Context, Effect, Layer, Data, Duration, Either } from 'effect'
import * as HttpClient from '@effect/platform/HttpClient'
import * as HCError from '@effect/platform/HttpClientError'
import type * as HttpClientType from '@effect/platform/HttpClient'
import { MAX_BULK_ISBN_COUNT } from '../../shared/utils/schemas'
import { DbService } from '../services/db.service'
import { putCoverImage, type StorageService } from '../services/storage.service'
import { DatabaseRateLimiter } from '../utils/database-rate-limiter'
import { consumeOpenLibraryCapacity, type OpenLibraryRequestPriority } from '../utils/open-library-capacity'
import { runtimeProfile } from '../runtime/profile.active'
import type { OpenLibraryBookData } from '../../shared/types/open-library'

// Error types
export class OpenLibraryBookNotFoundError extends Data.TaggedError('OpenLibraryBookNotFoundError')<{
  isbn: string
  message?: string
}> { }

export class OpenLibraryApiError extends Data.TaggedError('OpenLibraryApiError')<{
  message: string
  status?: number
}> { }

export class OpenLibraryCoverError extends Data.TaggedError('OpenLibraryCoverError')<{
  message: string
  isbn: string
}> { }

// Open Library Search and edition response formats
type OpenLibraryText = string | { type?: string, value?: unknown }

interface OpenLibraryBookDetails {
  title?: string
  authors?: Array<{ name?: string, url?: string, key?: string }>
  publishers?: Array<string | { name: string }>
  publish_date?: string
  number_of_pages?: number
  description?: OpenLibraryText
  notes?: OpenLibraryText
  excerpts?: Array<{ text?: OpenLibraryText }>
  covers?: number[]
  key?: string
  subjects?: Array<string | { name: string, url?: string }>
  works?: Array<{ key: string }>
}

interface OpenLibraryAuthorApiResponse {
  name?: string
}

interface OpenLibrarySearchResponse {
  docs?: Array<{
    key?: string
    title?: string
    author_name?: string[]
    edition_key?: string[]
    cover_i?: number
    publisher?: string[]
    publish_date?: string[]
    number_of_pages_median?: number
    isbn?: string[]
    subject?: string[]
    editions?: {
      docs?: Array<{
        key?: string
        title?: string
        author_name?: string[]
        isbn?: string[]
        cover_i?: number
        publisher?: string[]
        publish_date?: string[]
        number_of_pages?: number
        subject?: string[]
      }>
    }
  }>
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
  // The interactive core path deliberately performs only this ISBN search request.
  lookupCoreByISBN: (isbn: string) => Effect.Effect<OpenLibraryBookData, OpenLibraryBookNotFoundError | OpenLibraryApiError, HttpClientType.HttpClient>
  lookupByISBN: (isbn: string, priority?: OpenLibraryRequestPriority) => Effect.Effect<OpenLibraryBookData, OpenLibraryBookNotFoundError | OpenLibraryApiError, HttpClientType.HttpClient>
  /** Batch edition metadata only; skips author fallback and work hydration. */
  lookupCoreByISBNs: (isbns: string[], priority?: OpenLibraryRequestPriority) => Effect.Effect<Map<string, OpenLibraryBookData>, OpenLibraryApiError, HttpClientType.HttpClient>
  enrichMetadata: (data: OpenLibraryBookData, priority?: OpenLibraryRequestPriority) => Effect.Effect<OpenLibraryBookData, OpenLibraryApiError, HttpClientType.HttpClient>
  lookupByISBNs: (isbns: string[], priority?: OpenLibraryRequestPriority) => Effect.Effect<Map<string, OpenLibraryBookData>, OpenLibraryApiError, HttpClientType.HttpClient>
  downloadCover: (isbn: string, size?: 'S' | 'M' | 'L', providerCoverUrl?: string | null, priority?: OpenLibraryRequestPriority) => Effect.Effect<string | null, never, HttpClientType.HttpClient | StorageService>
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

function normalizeOpenLibraryWorkKey(key?: string): string | null {
  if (key?.startsWith('/works/')) return key
  if (key && /^OL[^/?#]+W$/i.test(key)) return `/works/${key}`
  return null
}

const DEFAULT_OPEN_LIBRARY_TIMEOUT_SECONDS = 12
const DEFAULT_OPEN_LIBRARY_COVER_TIMEOUT_SECONDS = 20
const DEFAULT_OPEN_LIBRARY_API_BASE = 'https://openlibrary.org'
const DEFAULT_OPEN_LIBRARY_COVERS_BASE = 'https://covers.openlibrary.org'
const OPEN_LIBRARY_HTTP_CONCURRENCY = 16
export const OPEN_LIBRARY_COVER_STORAGE_CONCURRENCY = 4
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

function normalizeAuthors(authors?: Array<{ name?: string }>) {
  if (!Array.isArray(authors)) return []
  return (authors ?? [])
    .map(author => typeof author?.name === 'string' ? author.name.trim() : '')
    .filter((author): author is string => Boolean(author))
}

const SEARCH_FIELDS = 'key,title,author_name,edition_key,cover_i,publisher,publish_date,number_of_pages_median,isbn,subject,editions,editions.key,editions.title,editions.author_name,editions.isbn,editions.cover_i,editions.publisher,editions.publish_date,editions.number_of_pages,editions.subject'

function buildISBNSearchUrl(apiBase: string, isbns: string[]) {
  const searchUrl = new URL(`${apiBase}/search.json`)
  searchUrl.searchParams.set('q', `isbn:(${isbns.join(' OR ')})`)
  searchUrl.searchParams.set('fields', SEARCH_FIELDS)
  searchUrl.searchParams.set('limit', String(getISBNSearchLimit(isbns)))
  return searchUrl.toString()
}

function getISBNSearchLimit(isbns: string[]) {
  return Math.max(isbns.length, 10)
}

function getMissingISBNsForFallback(
  chunk: string[],
  booksByIsbn: Map<string, OpenLibraryBookData>,
  response: OpenLibrarySearchResponse
) {
  const docs = response.docs ?? []
  const pageMayBeTruncated = docs.length >= getISBNSearchLimit(chunk)

  return chunk.filter((isbn) => {
    if (booksByIsbn.has(isbn)) return false
    return pageMayBeTruncated || hasSearchISBNMatch(response, isbn)
  })
}

function hasSearchISBNMatch(response: OpenLibrarySearchResponse, isbn: string) {
  return (response.docs ?? []).some(doc =>
    doc.isbn?.some(identifier => normalizeISBN(identifier) === isbn)
    || doc.editions?.docs?.some(edition => edition.isbn?.some(identifier => normalizeISBN(identifier) === isbn))
  )
}

function getBookForISBN(response: OpenLibrarySearchResponse, isbn: string, coversBase: string): OpenLibraryBookData | undefined {
  const entry = response.docs?.find(doc => doc.isbn?.some(identifier => normalizeISBN(identifier) === isbn))
  const edition = entry?.editions?.docs?.find(doc => doc.isbn?.some(identifier => normalizeISBN(identifier) === isbn))
  // A work can contain many ISBNs, while Search only returns one edition by
  // default. Do not attach another edition's key or metadata to this ISBN.
  if (!entry || !edition) return undefined
  const editionKey = edition.key ?? ''
  const coverId = edition.cover_i ?? entry.cover_i
  const subjects = edition.subject ?? entry.subject
  const editionAuthors = [...new Set((edition.author_name ?? []).map(name => name.trim()).filter(Boolean))]
  const authors = editionAuthors.length > 0
    ? editionAuthors
    : [...new Set((entry.author_name ?? []).map(name => name.trim()).filter(Boolean))]
  return {
    title: edition.title || entry.title || 'Unknown Title',
    authors: authors.length > 0 ? authors : ['Unknown Author'],
    isbn,
    openLibraryKey: editionKey.startsWith('/books/') ? editionKey : editionKey ? `/books/${editionKey}` : '',
    workKey: normalizeOpenLibraryWorkKey(entry.key),
    coverUrl: typeof coverId === 'number' && coverId > 0
      ? `${coversBase}/b/id/${coverId}-L.jpg?default=false`
      : null,
    subjects: subjects?.filter(subject => !subject.startsWith('nyt:')).slice(0, 20),
    publishDate: edition.publish_date?.[0] ?? entry.publish_date?.[0],
    publishers: edition.publisher ?? entry.publisher,
    numberOfPages: edition.number_of_pages ?? entry.number_of_pages_median,
    coverId
  }
}

function mapOpenLibraryEditionDetails(details: OpenLibraryBookDetails, isbn: string, coversBase: string): OpenLibraryBookData {
  const authors = normalizeAuthors(details.authors)
  const coverId = (Array.isArray(details.covers) ? details.covers : [])
    .find((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0)
  const publishers = (Array.isArray(details.publishers) ? details.publishers : [])
    .flatMap((publisher) => {
      if (typeof publisher === 'string') return [publisher]
      return publisher && typeof publisher.name === 'string' ? [publisher.name] : []
    })
  const subjects = (Array.isArray(details.subjects) ? details.subjects : [])
    .flatMap((subject) => {
      if (typeof subject === 'string') return [subject]
      return subject && typeof subject.name === 'string' ? [subject.name] : []
    })
    .filter(subject => !subject.startsWith('nyt:'))

  return {
    title: details.title?.trim() || 'Unknown Title',
    authors: authors.length > 0 ? authors : ['Unknown Author'],
    isbn,
    openLibraryKey: details.key?.startsWith('/books/')
      ? details.key
      : details.key ? `/books/${details.key}` : '',
    workKey: normalizeOpenLibraryWorkKey(Array.isArray(details.works) ? details.works[0]?.key : undefined),
    coverUrl: coverId ? `${coversBase}/b/id/${coverId}-L.jpg?default=false` : null,
    ...(coverId ? { coverId } : {}),
    description: extractOpenLibraryText(details.description)
      ?? extractOpenLibraryText(details.notes)
      ?? extractOpenLibraryText(Array.isArray(details.excerpts) ? details.excerpts[0]?.text : undefined),
    subjects,
    publishDate: details.publish_date,
    publishers,
    numberOfPages: details.number_of_pages
  }
}

// Helper to make HTTP GET request with timeout and get JSON response
const fetchJson = <T>(
  url: string,
  acquireSlot: Effect.Effect<void, OpenLibraryApiError>,
  operation: 'metadata' | 'work',
  timeout = getOpenLibraryTimeout()
) =>
  Effect.gen(function* () {
    const slotStartedAt = Date.now()
    yield* acquireSlot
    yield* Effect.logInfo('Open Library outbound slot acquired').pipe(
      Effect.annotateLogs({ operation, waitDurationMs: Date.now() - slotStartedAt })
    )
    const requestStartedAt = Date.now()
    const response = yield* HttpClient.get(url, { headers: getOpenLibraryHeaders() }).pipe(
      Effect.timeout(timeout),
      Effect.mapError(error => new OpenLibraryApiError({
        message: `HTTP request failed: ${HCError.isHttpClientError(error) ? error.message : String(error)}`
      }))
    )
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(new OpenLibraryApiError({
        message: `Open Library returned HTTP ${response.status} for ${new URL(url).pathname}`,
        status: response.status
      }))
    }
    const json = yield* response.json.pipe(
      Effect.mapError(error => new OpenLibraryApiError({
        message: `HTTP request failed: ${HCError.isHttpClientError(error) ? error.message : String(error)}`
      }))
    )
    yield* Effect.logInfo('Open Library request completed').pipe(
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

    const acquireDistributedSlotWithRetry = (priority: OpenLibraryRequestPriority, attempt = 0): Effect.Effect<void, OpenLibraryApiError> => Effect.suspend(() =>
      Effect.tryPromise({
        try: () => consumeOpenLibraryCapacity(limiter, Boolean(getOpenLibraryContactEmail()), priority),
        catch: error => new OpenLibraryApiError({ message: `Open Library rate limiter failed: ${String(error)}` })
      }).pipe(
        Effect.flatMap(result => result.allowed
          ? Effect.void
          : Effect.sleep(Duration.seconds(result.retryAfterSeconds)).pipe(
              Effect.flatMap(() => acquireDistributedSlotWithRetry(priority))
            )),
        Effect.catchAll(error => isSqliteBusy(error.message) && attempt < 6
          ? Effect.sleep(Duration.millis(25 * 2 ** attempt)).pipe(
              Effect.flatMap(() => acquireDistributedSlotWithRetry(priority, attempt + 1))
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
    const acquireSlot = (priority: OpenLibraryRequestPriority = 'interactive') => runtimeProfile === 'selfhost'
      ? acquireLocalSlot
      : acquireDistributedSlotWithRetry(priority)

    const resolveEditionAuthors = (details: OpenLibraryBookDetails, apiBase: string, priority: OpenLibraryRequestPriority) => {
      const authors = normalizeAuthors(details.authors)
      const authorKeys = [...new Set((details.authors ?? [])
        .map(author => author.key)
        .filter((key): key is string => Boolean(key?.startsWith('/authors/'))))]
      if (authors.length > 0 || authorKeys.length === 0) return Effect.succeed(authors)
      return Effect.forEach(
        authorKeys.slice(0, 3),
        key => fetchJson<OpenLibraryAuthorApiResponse>(`${apiBase}${key}.json`, acquireSlot(priority), 'metadata').pipe(
          Effect.map(author => author.name?.trim() ?? ''),
          Effect.catchAll(error => Effect.logDebug(`[OpenLibrary] Author lookup failed for ${key}: ${String(error)}`).pipe(Effect.as('')))
        ),
        { concurrency: 3 }
      ).pipe(Effect.map(names => names.filter(Boolean)))
    }

    const lookupByISBNs = (isbns: string[], priority: OpenLibraryRequestPriority = 'interactive') =>
      Effect.gen(function* () {
        const normalized = [...new Set(isbns.map(normalizeISBN))]
        const booksByIsbn = new Map<string, OpenLibraryBookData>()
        const apiBase = getOpenLibraryApiBase()
        const coversBase = getOpenLibraryCoversBase()

        for (let start = 0; start < normalized.length; start += MAX_BULK_ISBN_COUNT) {
          const chunk = normalized.slice(start, start + MAX_BULK_ISBN_COUNT)
          const response = yield* fetchJson<OpenLibrarySearchResponse>(
            buildISBNSearchUrl(apiBase, chunk),
            acquireSlot(priority),
            'metadata'
          )
          for (const isbn of chunk) {
            const book = getBookForISBN(response, isbn, coversBase)
            if (book) booksByIsbn.set(isbn, book)
          }

          // Search returns only one edition per work. If a chunk contains
          // multiple ISBNs from the same work, resolve the omitted editions
          // individually so each ISBN retains its own edition metadata.
          const missingISBNs = getMissingISBNsForFallback(chunk, booksByIsbn, response)
          const fallbackBooks = yield* Effect.forEach(
            missingISBNs,
            isbn => fetchJson<OpenLibrarySearchResponse>(
              buildISBNSearchUrl(apiBase, [isbn]),
              acquireSlot(priority),
              'metadata'
            ).pipe(Effect.map(response => [isbn, getBookForISBN(response, isbn, coversBase)] as const)),
            { concurrency: OPEN_LIBRARY_HTTP_CONCURRENCY }
          )
          for (const [isbn, book] of fallbackBooks) {
            if (book) booksByIsbn.set(isbn, book)
          }
        }

        const booksNeedingWork = [...booksByIsbn.values()].filter(book =>
          Boolean(book.workKey)
          && (!book.description || (book.subjects?.length ?? 0) < MIN_ENRICHED_SUBJECT_COUNT)
        )
        const workKeys = [...new Set(booksNeedingWork.map(book => book.workKey).filter((key): key is string => Boolean(key)))]
        const workResults = yield* Effect.forEach(
          workKeys,
          key => fetchJson<OpenLibraryWorksApiResponse>(`${apiBase}${key}.json`, acquireSlot(priority), 'work').pipe(
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

    // Bulk intake only needs enough edition metadata to render a preview and
    // persist a durable core row. Optional authors, works, subjects, and
    // covers are completed by the enrichment worker after the request returns.
    const lookupCoreByISBNs = (isbns: string[], priority: OpenLibraryRequestPriority = 'interactive') =>
      Effect.gen(function* () {
        const normalized = [...new Set(isbns.map(normalizeISBN))]
        const booksByIsbn = new Map<string, OpenLibraryBookData>()
        const apiBase = getOpenLibraryApiBase()
        const coversBase = getOpenLibraryCoversBase()

        for (let start = 0; start < normalized.length; start += MAX_BULK_ISBN_COUNT) {
          const chunk = normalized.slice(start, start + MAX_BULK_ISBN_COUNT)
          const response = yield* fetchJson<OpenLibrarySearchResponse>(
            buildISBNSearchUrl(apiBase, chunk),
            acquireSlot(priority),
            'metadata'
          )
          for (const isbn of chunk) {
            const book = getBookForISBN(response, isbn, coversBase)
            if (book) booksByIsbn.set(isbn, book)
          }

          const missingISBNs = getMissingISBNsForFallback(chunk, booksByIsbn, response)
          const fallbackBooks = yield* Effect.forEach(
            missingISBNs,
            isbn => fetchJson<OpenLibrarySearchResponse>(
              buildISBNSearchUrl(apiBase, [isbn]),
              acquireSlot(priority),
              'metadata'
            ).pipe(Effect.map(response => [isbn, getBookForISBN(response, isbn, coversBase)] as const)),
            { concurrency: OPEN_LIBRARY_HTTP_CONCURRENCY }
          )
          for (const [isbn, book] of fallbackBooks) {
            if (book) booksByIsbn.set(isbn, book)
          }
        }
        return booksByIsbn
      })

    const lookupCoreByISBN = (isbn: string) =>
      Effect.gen(function* () {
        const normalizedISBN = normalizeISBN(isbn)
        const apiBase = getOpenLibraryApiBase()
        const coversBase = getOpenLibraryCoversBase()
        const response = yield* fetchJson<OpenLibrarySearchResponse>(
          buildISBNSearchUrl(apiBase, [normalizedISBN]),
          acquireSlot('interactive'),
          'metadata'
        )
        const book = getBookForISBN(response, normalizedISBN, coversBase)
        if (book) return book
        if (!hasSearchISBNMatch(response, normalizedISBN)) {
          return yield* Effect.fail(new OpenLibraryBookNotFoundError({
            isbn: normalizedISBN,
            message: 'Open Library has no edition record for this ISBN'
          }))
        }

        // Search can identify the matching work ISBN without returning its
        // nested edition. Fall back to the ISBN endpoint only for that miss.
        const details = yield* fetchJson<OpenLibraryBookDetails>(
          `${apiBase}/isbn/${encodeURIComponent(normalizedISBN)}.json`,
          acquireSlot('interactive'),
          'metadata'
        ).pipe(
          Effect.catchAll((error): Effect.Effect<never, OpenLibraryBookNotFoundError | OpenLibraryApiError> => {
            if (error instanceof OpenLibraryApiError && error.status === 404) {
              return Effect.fail(new OpenLibraryBookNotFoundError({
                isbn: normalizedISBN,
                message: 'Open Library has no edition record for this ISBN'
              }))
            }
            return Effect.fail(error)
          })
        )
        return mapOpenLibraryEditionDetails(details, normalizedISBN, coversBase)
      })

    // Complete a persisted core payload without repeating its edition request.
    // Only fetch the optional author fallback and work record when the seed is
    // missing those fields.
    const enrichMetadata = (seed: OpenLibraryBookData, priority: OpenLibraryRequestPriority = 'enrichment') =>
      Effect.gen(function* () {
        const apiBase = getOpenLibraryApiBase()
        let authors = seed.authors
        if (authors.length === 0 || (authors.length === 1 && authors[0] === 'Unknown Author')) {
          const edition = yield* fetchJson<OpenLibraryBookDetails>(
            `${apiBase}/isbn/${encodeURIComponent(normalizeISBN(seed.isbn))}.json`,
            acquireSlot(priority),
            'metadata'
          ).pipe(
            Effect.either
          )
          if (Either.isRight(edition)) {
            authors = yield* resolveEditionAuthors(edition.right, apiBase, priority)
            if (authors.length === 0) authors = seed.authors
          } else {
            yield* Effect.logDebug(`[OpenLibrary] Optional ISBN author lookup failed: ${String(edition.left)}`)
          }
        }
        if (!seed.workKey || (seed.description && (seed.subjects?.length ?? 0) >= MIN_ENRICHED_SUBJECT_COUNT)) {
          return { ...seed, authors }
        }
        const work = yield* fetchJson<OpenLibraryWorksApiResponse>(`${apiBase}${seed.workKey}.json`, acquireSlot(priority), 'work').pipe(
          Effect.catchAll(error => Effect.logDebug(`[OpenLibrary] Optional work enrichment failed: ${String(error)}`).pipe(Effect.as(null)))
        )
        if (!work) return { ...seed, authors }
        const description = seed.description || extractOpenLibraryText(work.description)
        const subjects = seed.subjects && seed.subjects.length >= MIN_ENRICHED_SUBJECT_COUNT
          ? seed.subjects
          : [...new Set([...(seed.subjects || []), ...(work.subjects || []).filter(subject => !subject.startsWith('nyt:'))])].slice(0, 20)
        return { ...seed, authors, description, subjects }
      })

    const fetchCoverImage = (isbn: string, size: 'S' | 'M' | 'L', providerCoverUrl?: string | null, priority: OpenLibraryRequestPriority = 'interactive') =>
      Effect.gen(function* () {
        const normalizedISBN = normalizeISBN(isbn)
        const coverUrl = providerCoverUrl
          ? providerCoverUrl.replace(/-(?:S|M|L)\.jpg(?:\?[^/]*)?$/, `-${size}.jpg?default=false`)
          : `${getOpenLibraryCoversBase()}/b/isbn/${normalizedISBN}-${size}.jpg?default=false`
        const slotStartedAt = Date.now()
        const acquired = yield* acquireSlot(priority).pipe(
          Effect.as(true),
          Effect.catchAll(error =>
            Effect.logWarning(error.message).pipe(Effect.as(false))
          )
        )
        if (!acquired) return null
        yield* Effect.logInfo('Open Library outbound slot acquired').pipe(
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
        yield* Effect.logInfo('Open Library request completed').pipe(
          Effect.annotateLogs({ operation: 'cover', requestDurationMs: Date.now() - requestStartedAt })
        )
        return image
      })

    const downloadCovers = (isbns: string[], size: 'S' | 'M' | 'L' = 'L', providerUrls?: Map<string, string | null>, priority: OpenLibraryRequestPriority = 'interactive') =>
      Effect.gen(function* () {
        const normalized = [...new Set(isbns.map(normalizeISBN))]
        const storageSemaphore = yield* Effect.makeSemaphore(OPEN_LIBRARY_COVER_STORAGE_CONCURRENCY)
        const results = yield* Effect.forEach(
          normalized,
          isbn => Effect.gen(function* () {
            const imageBuffer = yield* fetchCoverImage(isbn, size, providerUrls?.get(isbn), priority)
            if (!imageBuffer) {
              yield* Effect.log(`[OpenLibrary] No cover found for ISBN ${isbn}`)
              return [isbn, null] as const
            }

            const pathname = `covers/${isbn}.webp`
            const storageStartedAt = Date.now()
            const coverPath = yield* storageSemaphore.withPermits(1)(
              putCoverImage(pathname, imageBuffer).pipe(
                Effect.tap(() => Effect.logInfo('Open Library cover stored').pipe(
                  Effect.annotateLogs({
                    operation: 'cover-storage',
                    isbn,
                    storageDurationMs: Date.now() - storageStartedAt
                  })
                )),
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
      lookupCoreByISBN,
      lookupCoreByISBNs,
      enrichMetadata,
      lookupByISBNs,
      lookupByISBN: (isbn, priority = 'interactive') =>
        Effect.gen(function* () {
          const normalizedISBN = normalizeISBN(isbn)
          const books = yield* lookupByISBNs([normalizedISBN], priority)
          const book = books.get(normalizedISBN)
          if (book) return book
          return yield* Effect.fail(new OpenLibraryBookNotFoundError({
            isbn: normalizedISBN,
            message: `Book with ISBN ${normalizedISBN} not found`
          }))
        }),

      downloadCovers,
      downloadCover: (isbn, size = 'L', providerCoverUrl = null, priority = 'interactive') =>
        downloadCovers([isbn], size, new Map([[normalizeISBN(isbn), providerCoverUrl]]), priority).pipe(
          Effect.map(covers => covers.get(normalizeISBN(isbn)) ?? null)
        )
    }
  })
)

// Helper effects
export const lookupByISBN = (isbn: string, priority?: OpenLibraryRequestPriority) =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.lookupByISBN(isbn, priority))

export const lookupByISBNs = (isbns: string[], priority?: OpenLibraryRequestPriority) =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.lookupByISBNs(isbns, priority))

export const lookupCoreByISBNs = (isbns: string[], priority?: OpenLibraryRequestPriority) =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.lookupCoreByISBNs(isbns, priority))

export const downloadCover = (isbn: string, size?: 'S' | 'M' | 'L', providerCoverUrl?: string | null, priority?: OpenLibraryRequestPriority) =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.downloadCover(isbn, size, providerCoverUrl, priority))

export const downloadCovers = (isbns: string[], size?: 'S' | 'M' | 'L') =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.downloadCovers(isbns, size))
