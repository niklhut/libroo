import { Context, Effect, Layer, Data, Duration } from 'effect'
import { HttpClient } from '@effect/platform'
import * as HCError from '@effect/platform/HttpClientError'
import type { HttpClient as HttpClientType } from '@effect/platform'
import sharp from 'sharp'

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
interface OpenLibraryBooksApiResponse {
  [key: string]: {
    title: string
    authors?: Array<{ name: string, url?: string }>
    publishers?: Array<{ name: string }>
    publish_date?: string
    number_of_pages?: number
    notes?: string
    excerpts?: Array<{ text: string }>
    cover?: {
      small?: string
      medium?: string
      large?: string
    }
    key?: string
    url?: string
    subjects?: Array<{ name: string, url?: string }>
  }
}

// OpenLibrary Works API response
interface OpenLibraryWorksApiResponse {
  key: string
  title: string
  description?: string | { type: string, value: string }
  subjects?: string[]
  subject_places?: string[]
  subject_times?: string[]
  covers?: number[]
}

// Service interface
export interface OpenLibraryRepositoryInterface {
  lookupByISBN: (isbn: string) => Effect.Effect<OpenLibraryBookData, OpenLibraryBookNotFoundError | OpenLibraryApiError, HttpClientType.HttpClient>
  downloadCover: (isbn: string, size?: 'S' | 'M' | 'L') => Effect.Effect<string | null, never, HttpClientType.HttpClient | StorageService>
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

// Helper to make HTTP GET request with timeout and get JSON response
const fetchJson = <T>(url: string) =>
  HttpClient.get(url).pipe(
    Effect.timeout(Duration.seconds(5)),
    Effect.flatMap(response => response.json),
    Effect.map(json => json as T),
    Effect.mapError((error) => new OpenLibraryApiError({
      message: `HTTP request failed: ${HCError.isHttpClientError(error) ? error.message : String(error)}`
    }))
  )

// Helper to check if a cover URL exists using HEAD request
const checkCoverExists = (coverUrl: string) =>
  HttpClient.head(
    coverUrl.includes('?') ? `${coverUrl}&default=false` : `${coverUrl}?default=false`
  ).pipe(
    Effect.timeout(Duration.seconds(5)),
    Effect.flatMap(response => {
      if (response.status < 200 || response.status >= 300) {
        return Effect.succeed(false)
      }
      // Check content length to detect placeholder images (1x1 pixels are very small)
      const contentLength = response.headers['content-length']
      if (contentLength && parseInt(contentLength) < 1000) {
        return Effect.succeed(false)
      }
      return Effect.succeed(true)
    }),
    Effect.catchAll(() => Effect.succeed(false))
  )

// Live implementation
export const OpenLibraryRepositoryLive = Layer.succeed(OpenLibraryRepository, {
  lookupByISBN: isbn =>
    Effect.gen(function* () {
      const normalizedISBN = normalizeISBN(isbn)
      const bibkey = `ISBN:${normalizedISBN}`

      // Fetch book data from OpenLibrary API
      const data = yield* fetchJson<OpenLibraryBooksApiResponse>(
        `https://openlibrary.org/api/books?bibkeys=${bibkey}&jscmd=data&format=json`
      )

      const bookData = data[bibkey]

      if (!bookData) {
        return yield* Effect.fail(new OpenLibraryBookNotFoundError({
          isbn: normalizedISBN,
          message: `Book with ISBN ${normalizedISBN} not found`
        }))
      }

      // Extract authors
      const authors = bookData.authors?.map(a => a.name) || ['Unknown Author']

      // Use the same cover URL format that downloadCover uses, so preview matches the downloaded image
      // The ISBN-based URL is the most reliable and follows redirects consistently
      const coverUrlToCheck = `https://covers.openlibrary.org/b/isbn/${normalizedISBN}-L.jpg?default=false`
      const coverExists = yield* checkCoverExists(coverUrlToCheck)
      const coverUrl = coverExists ? coverUrlToCheck : null

      // Extract publishers
      const publishers = bookData.publishers?.map(p => p.name)

      // Extract subjects (filter out NYT-specific ones)
      let subjects = bookData.subjects
        ?.map(s => s.name)
        .filter(s => !s.startsWith('nyt:'))
        .slice(0, 20) // Limit to 20 subjects

      // The bookData.key is the edition key like "/books/OL24303521M"
      const editionKey = bookData.key

      // Try to get description from notes/excerpts first
      let description = bookData.notes || bookData.excerpts?.[0]?.text
      let workKey: string | null = null

      // If we have an edition key, try to fetch works data for description
      if (editionKey) {
        yield* Effect.gen(function* () {
          const editionData = yield* fetchJson<{ works?: Array<{ key: string }> }>(
            `https://openlibrary.org${editionKey}.json`
          )

          if (editionData.works && editionData.works.length > 0) {
            const firstWork = editionData.works[0]
            if (firstWork) {
              workKey = firstWork.key

              const worksData = yield* fetchJson<OpenLibraryWorksApiResponse>(
                `https://openlibrary.org${workKey}.json`
              )

              // Extract description
              if (worksData.description) {
                if (typeof worksData.description === 'string') {
                  description = worksData.description
                } else if (worksData.description.value) {
                  description = worksData.description.value
                }
              }

              // Merge subjects from works if we don't have enough
              if ((!subjects || subjects.length < 5) && worksData.subjects) {
                const worksSubjects = worksData.subjects
                  .filter(s => !s.startsWith('nyt:'))
                  .slice(0, 20)
                subjects = [...new Set([...(subjects || []), ...worksSubjects])].slice(0, 20)
              }
            }
          }
        }).pipe(
          Effect.catchAll(err =>
            Effect.logDebug(`[OpenLibrary] Error fetching additional work data for ISBN ${normalizedISBN}: ${err}`)
          )
        )
      }

      return {
        title: bookData.title || 'Unknown Title',
        authors,
        isbn: normalizedISBN,
        openLibraryKey: editionKey || '',
        workKey,
        coverUrl,
        description,
        subjects,
        publishDate: bookData.publish_date,
        publishers,
        numberOfPages: bookData.number_of_pages
      }
    }),

  downloadCover: (isbn, size = 'L') =>
    Effect.gen(function* () {
      console.log("downloadCover", isbn, size)
      const normalizedISBN = normalizeISBN(isbn)
      const coverUrl = `https://covers.openlibrary.org/b/isbn/${normalizedISBN}-${size}.jpg?default=false`

      // Fetch cover and read body in a single scoped operation
      const imageBuffer = yield* HttpClient.get(coverUrl).pipe(
        Effect.timeout(Duration.seconds(10)),
        Effect.flatMap(response => {
          if (response.status < 200 || response.status >= 300) {
            // No cover available, return null (not an error)
            console.log("No cover available for ISBN", normalizedISBN)
            return Effect.succeed(null as ArrayBuffer | null)
          }

          // Check if we got a valid image (OpenLibrary returns a 1x1 transparent pixel for missing covers)
          const contentLength = response.headers['content-length']
          if (contentLength && parseInt(contentLength) < 1000) {
            // Too small, probably the placeholder image
            console.log("Too small, probably the placeholder image", normalizedISBN)
            return Effect.succeed(null as ArrayBuffer | null)
          }

          // Read the body within the same scope as the request
          console.log("Read the body within the same scope as the request", normalizedISBN)
          return response.arrayBuffer
        }),
        Effect.mapError((error) => new OpenLibraryCoverError({
          message: `Failed to fetch cover: ${HCError.isHttpClientError(error) ? error.message : String(error)}`,
          isbn: normalizedISBN
        }))
      )

      console.log("image Buffer", imageBuffer?.byteLength)

      if (!imageBuffer) {
        yield* Effect.log(`[OpenLibrary] No cover found for ISBN ${normalizedISBN}`)
        return null
      }

      console.log("image Buffer", imageBuffer.byteLength)

      // Convert to WebP using sharp
      const webpBuffer = yield* Effect.tryPromise({
        try: () => sharp(Buffer.from(imageBuffer)).webp({ quality: 85 }).toBuffer(),
        catch: (error) => new OpenLibraryCoverError({
          message: `Failed to convert cover to WebP: ${error}`,
          isbn: normalizedISBN
        })
      })

      const pathname = `covers/${normalizedISBN}.webp`

      // Store in blob storage, return null if storage fails
      return yield* putBlob(pathname, webpBuffer, { contentType: 'image/webp' }).pipe(
        Effect.map(blobMetadata => blobMetadata.pathname),
        Effect.catchAll((error) =>
          Effect.logWarning(`Failed to store cover in blob storage: ${error}`).pipe(
            Effect.map(() => null)
          )
        )
      )
    }).pipe(
      // If cover download fails, just return null instead of failing the whole operation
      Effect.catchTag('OpenLibraryCoverError', (error) =>
        Effect.logWarning(`Cover download failed for ISBN ${error.isbn}: ${error.message}`).pipe(
          Effect.map(() => null)
        )
      )
    )
})

// Helper effects
export const lookupByISBN = (isbn: string) =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.lookupByISBN(isbn))

export const downloadCover = (isbn: string, size?: 'S' | 'M' | 'L') =>
  Effect.flatMap(OpenLibraryRepository, repo => repo.downloadCover(isbn, size))
