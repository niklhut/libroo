import { Context, Effect, Layer, Data } from 'effect'
import { StorageService, putBlob } from '../services/storage.service'

// Error types
export class BookNotFoundError extends Data.TaggedError('BookNotFoundError')<{
  isbn: string
  message?: string
}> { }

export class OpenLibraryApiError extends Data.TaggedError('OpenLibraryApiError')<{
  message: string
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
    authors?: Array<{ name: string; url?: string }>
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
    subjects?: Array<{ name: string; url?: string }>
  }
}

// OpenLibrary Works API response
interface OpenLibraryWorksApiResponse {
  key: string
  title: string
  description?: string | { type: string; value: string }
  subjects?: string[]
  subject_places?: string[]
  subject_times?: string[]
  covers?: number[]
}

// Service interface
export interface OpenLibraryRepositoryInterface {
  lookupByISBN: (isbn: string) => Effect.Effect<OpenLibraryBookData, BookNotFoundError | OpenLibraryApiError>
  downloadCover: (isbn: string, size?: 'S' | 'M' | 'L') => Effect.Effect<string | null, Error, StorageService>
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

// Extract work key from edition key
function extractWorkKeyFromUrl(url?: string): string | null {
  if (!url) return null
  // URL like: https://openlibrary.org/books/OL24303521M/...
  // We need to find the works link from the book data
  return null
}

// Live implementation
export const OpenLibraryRepositoryLive = Layer.succeed(OpenLibraryRepository, {
  lookupByISBN: (isbn) =>
    Effect.tryPromise({
      try: async () => {
        const normalizedISBN = normalizeISBN(isbn)
        const bibkey = `ISBN:${normalizedISBN}`

        // Use the /api/books endpoint which returns more complete data including authors
        const response = await fetch(
          `https://openlibrary.org/api/books?bibkeys=${bibkey}&jscmd=data&format=json`
        )

        if (!response.ok) {
          throw new OpenLibraryApiError({
            message: `OpenLibrary API error: ${response.status}`
          })
        }

        const data: OpenLibraryBooksApiResponse = await response.json()
        const bookData = data[bibkey]

        if (!bookData) {
          throw new BookNotFoundError({
            isbn: normalizedISBN,
            message: `Book with ISBN ${normalizedISBN} not found`
          })
        }

        // Extract authors
        const authors = bookData.authors?.map(a => a.name) || ['Unknown Author']

        // Extract cover URL (prefer large)
        const coverUrl = bookData.cover?.large
          || bookData.cover?.medium
          || `https://covers.openlibrary.org/b/isbn/${normalizedISBN}-L.jpg`

        // Extract publishers
        const publishers = bookData.publishers?.map(p => p.name)

        // Extract subjects (filter out NYT-specific ones)
        let subjects = bookData.subjects
          ?.map(s => s.name)
          .filter(s => !s.startsWith('nyt:'))
          .slice(0, 20) // Limit to 20 subjects

        // The bookData.key is the edition key like "/books/OL24303521M"
        // We need to fetch the edition page to get the works key
        const editionKey = bookData.key

        // Try to get description from notes/excerpts first
        let description = bookData.notes || bookData.excerpts?.[0]?.text

        // If no description and we have an edition key, try to fetch works data
        let workKey: string | null = null
        if (editionKey) {
          try {
            // Fetch the edition to get the works key
            const editionResponse = await fetch(`https://openlibrary.org${editionKey}.json`)
            if (editionResponse.ok) {
              const editionData = await editionResponse.json()
              // Works key is at editionData.works[0].key
              if (editionData.works && editionData.works.length > 0) {
                workKey = editionData.works[0].key

                // Fetch works data for description
                const worksResponse = await fetch(`https://openlibrary.org${workKey}.json`)
                if (worksResponse.ok) {
                  const worksData: OpenLibraryWorksApiResponse = await worksResponse.json()

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
            }
          } catch {
            // Ignore errors fetching additional data - it's optional
          }
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
      },
      catch: (error) => {
        if (error instanceof BookNotFoundError || error instanceof OpenLibraryApiError) {
          return error
        }
        return new OpenLibraryApiError({
          message: `Failed to lookup ISBN: ${error}`
        })
      }
    }),

  downloadCover: (isbn, size = 'L') =>
    Effect.tryPromise({
      try: async () => {
        const normalizedISBN = normalizeISBN(isbn)
        const coverUrl = `https://covers.openlibrary.org/b/isbn/${normalizedISBN}-${size}.jpg`

        const response = await fetch(coverUrl)

        if (!response.ok) {
          // No cover available, return null (not an error)
          return null
        }

        // Check if we got a valid image (OpenLibrary returns a 1x1 transparent pixel for missing covers)
        const contentLength = response.headers.get('content-length')
        if (contentLength && parseInt(contentLength) < 1000) {
          // Too small, probably the placeholder image
          return null
        }

        const imageBuffer = await response.arrayBuffer()
        const contentType = response.headers.get('content-type') || 'image/jpeg'

        // Store in blob - we'll do this in a separate step
        return { imageBuffer, contentType, pathname: `covers/${normalizedISBN}.jpg` }
      },
      catch: (error) => new Error(`Failed to download cover: ${error}`)
    }).pipe(
      Effect.flatMap((result) => {
        if (!result) {
          return Effect.succeed(null)
        }
        return putBlob(result.pathname, result.imageBuffer, { contentType: result.contentType }).pipe(
          Effect.map((blobMetadata) => blobMetadata.pathname),
          Effect.catchAll(() => Effect.succeed(null)) // If blob storage fails, just return null
        )
      })
    )
})

// Helper effects
export const lookupByISBN = (isbn: string) =>
  Effect.flatMap(OpenLibraryRepository, (repo) => repo.lookupByISBN(isbn))

export const downloadCover = (isbn: string, size?: 'S' | 'M' | 'L') =>
  Effect.flatMap(OpenLibraryRepository, (repo) => repo.downloadCover(isbn, size))
