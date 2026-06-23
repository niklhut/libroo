import { Effect } from 'effect'
import { z } from 'zod'

const addBookSchema = bookIsbnSchema.extend({
  previewCoverPath: z.string().nullable().optional()
})

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readValidatedBody(event, addBookSchema.parse),
      catch: e => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })

    // Add book by ISBN via BookService
    return yield* addBookToLibraryWithPreviewCover(user.id, body.isbn, {
      previewCoverPath: body.previewCoverPath
    })
  })
)
