import { Effect } from 'effect'
import { effectHandlerPublic } from '../../utils/effectHandler'
import { lookupByISBN } from '../../repositories/openLibrary.repository'

// This endpoint doesn't require auth - anyone can preview a book lookup
export default effectHandlerPublic((event) =>
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

    // Try to lookup the book - catch NotFound errors and return found: false
    const lookupEffect = lookupByISBN(body.isbn).pipe(
      Effect.map((bookData) => ({
        found: true,
        isbn: bookData.isbn,
        title: bookData.title,
        author: bookData.authors.join(', '),
        coverUrl: bookData.coverUrl,
        description: bookData.description,
        subjects: bookData.subjects,
        publishDate: bookData.publishDate,
        publishers: bookData.publishers,
        numberOfPages: bookData.numberOfPages
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
