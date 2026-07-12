import { Effect } from 'effect'
import { z } from 'zod'
import { getBulkAddMaxCount } from '../../utils/books-config'

const bulkAddBookSchema = bookIsbnAddSchema

function createBulkAddSchema(maxCount: number) {
  return z.object({
    isbns: z.array(bookIsbnSchema.shape.isbn).max(maxCount).optional(),
    books: z.array(bulkAddBookSchema).max(maxCount).optional()
  }).superRefine((body, ctx) => {
    const hasBooks = (body.books?.length ?? 0) > 0
    const hasIsbns = (body.isbns?.length ?? 0) > 0

    if (!hasBooks && !hasIsbns) {
      ctx.addIssue({
        code: 'custom',
        message: 'At least one ISBN is required'
      })
    }

    if (hasBooks && hasIsbns) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide either books or isbns, not both'
      })
    }
  })
}

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, createBulkAddSchema(getBulkAddMaxCount()).parse),
      catch: e => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })

    const books = body.books?.length
      ? body.books
      : body.isbns!.map((isbn: string) => ({ isbn, libraryState: 'owned' as const }))
    return yield* bulkAddBooks(user.id, books)
  })
)
