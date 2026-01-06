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
  coverUrl: string | null
  publishDate?: string
  publishers?: string[]
  numberOfPages?: number
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

// Live implementation
export const OpenLibraryRepositoryLive = Layer.succeed(OpenLibraryRepository, {
  lookupByISBN: (isbn) =>
    Effect.tryPromise({
      try: async () => {
        const normalizedISBN = normalizeISBN(isbn)

        // Fetch book data from OpenLibrary
        const response = await fetch(`https://openlibrary.org/isbn/${normalizedISBN}.json`)

        if (!response.ok) {
          if (response.status === 404) {
            throw new BookNotFoundError({
              isbn: normalizedISBN,
              message: `Book with ISBN ${normalizedISBN} not found`
            })
          }
          throw new OpenLibraryApiError({
            message: `OpenLibrary API error: ${response.status}`
          })
        }

        const data = await response.json()

        // Get author names (need to fetch author details)
        let authors: string[] = []
        if (data.authors && Array.isArray(data.authors)) {
          const authorPromises = data.authors.map(async (author: { key: string }) => {
            try {
              const authorResponse = await fetch(`https://openlibrary.org${author.key}.json`)
              if (authorResponse.ok) {
                const authorData = await authorResponse.json()
                return authorData.name || 'Unknown Author'
              }
            } catch {
              // Ignore author fetch errors
            }
            return 'Unknown Author'
          })
          authors = await Promise.all(authorPromises)
        }

        // Determine cover URL
        const coverUrl = data.covers && data.covers.length > 0
          ? `https://covers.openlibrary.org/b/id/${data.covers[0]}-L.jpg`
          : `https://covers.openlibrary.org/b/isbn/${normalizedISBN}-L.jpg`

        return {
          title: data.title || 'Unknown Title',
          authors: authors.length > 0 ? authors : ['Unknown Author'],
          isbn: normalizedISBN,
          openLibraryKey: data.key || '',
          coverUrl,
          publishDate: data.publish_date,
          publishers: data.publishers,
          numberOfPages: data.number_of_pages
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
