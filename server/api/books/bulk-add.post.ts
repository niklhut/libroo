import { Effect } from 'effect'
import { z } from 'zod'

const bulkAddBookSchema = z.object({
  isbn: z.string().min(10).max(13),
  previewCoverPath: z.string().nullable().optional()
})

const bulkAddSchema = z.object({
  isbns: z.array(z.string().min(10).max(13)).max(20).optional(),
  books: z.array(bulkAddBookSchema).max(20).optional()
}).refine(body => ((body.books?.length ?? 0) + (body.isbns?.length ?? 0)) > 0, {
  message: 'At least one ISBN is required'
})

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, bulkAddSchema.parse),
      catch: e => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })

    const books = body.books?.length
      ? body.books
      : body.isbns!.map((isbn: string) => ({ isbn }))
    return yield* bulkAddBooks(user.id, books)
  })
)
