import { runEffect, Effect } from '../../utils/effect'
import { lookupByISBN } from '../../repositories/openLibrary.repository'

export default defineEventHandler(async (event) => {
  // Read request body
  const body = await readBody(event)

  if (!body?.isbn) {
    throw createError({
      statusCode: 400,
      message: 'ISBN is required'
    })
  }

  try {
    return await runEffect(
      Effect.gen(function* () {
        // Lookup book from OpenLibrary (no auth required for preview)
        const bookData = yield* lookupByISBN(body.isbn)

        return {
          found: true,
          isbn: bookData.isbn,
          title: bookData.title,
          author: bookData.authors.join(', '),
          coverUrl: bookData.coverUrl,
          publishDate: bookData.publishDate,
          publishers: bookData.publishers,
          numberOfPages: bookData.numberOfPages
        }
      }),
      event
    )
  } catch (error: any) {
    if (error._tag === 'BookNotFoundError') {
      return {
        found: false,
        isbn: body.isbn,
        message: 'Book not found on OpenLibrary'
      }
    }
    if (error._tag === 'OpenLibraryApiError') {
      throw createError({
        statusCode: 502,
        message: `Failed to lookup book: ${error.message}`
      })
    }
    throw error
  }
})
