import { Effect } from 'effect'
import { effectHandler } from '../../utils/effectHandler'
import { lookupByISBN } from '../../repositories/openLibrary.repository'
import { books } from 'hub:db:schema'
import { eq } from 'drizzle-orm'
import { db } from 'hub:db'

// Lookup endpoint requires auth - users can preview books before adding
export default effectHandler((event, _user) =>
  Effect.gen(function* () {
    // Read request body
    const body = yield* Effect.tryPromise({
      try: () => readBody(event),
      catch: () => new Error('Invalid request body')
    })

    // Validate ISBN
    if (!body?.isbn || typeof body.isbn !== 'string') {
      return yield* Effect.fail(
        createError({
          statusCode: 400,
          message: 'ISBN is required'
        })
      )
    }

    const normalizedISBN = body.isbn.replace(/[-\s]/g, '')

    // First, check if book exists in local database
    const localBookEffect = Effect.tryPromise({
      try: async () => {
        const [localBook] = await db.select().from(books).where(eq(books.isbn, normalizedISBN)).limit(1)
        return localBook
      },
      catch: () => null
    })

    const localBook = yield* localBookEffect

    // If found locally, return that data
    if (localBook) {
      return {
        found: true,
        isbn: localBook.isbn || normalizedISBN,
        title: localBook.title,
        author: localBook.author,
        coverUrl: localBook.coverPath ? `/api/blob/${localBook.coverPath}` : null,
        description: localBook.description,
        subjects: localBook.subjects ? JSON.parse(localBook.subjects) : null,
        publishDate: localBook.publishDate,
        publishers: localBook.publishers ? localBook.publishers.split(', ') : null,
        numberOfPages: localBook.numberOfPages,
        existsLocally: true
      }
    }

    // Not found locally, try OpenLibrary
    const lookupEffect = lookupByISBN(body.isbn).pipe(
      Effect.map(bookData => ({
        found: true,
        isbn: bookData.isbn,
        title: bookData.title,
        author: bookData.authors.join(', '),
        coverUrl: bookData.coverUrl,
        description: bookData.description,
        subjects: bookData.subjects,
        publishDate: bookData.publishDate,
        publishers: bookData.publishers,
        numberOfPages: bookData.numberOfPages,
        existsLocally: false
      })),
      Effect.catchTag('BookNotFoundError', () =>
        Effect.succeed({
          found: false,
          isbn: body.isbn,
          message: 'Book not found on OpenLibrary'
        })
      )
    )

    return yield* lookupEffect
  })
)
