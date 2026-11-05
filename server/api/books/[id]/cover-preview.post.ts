import { Effect } from 'effect'
import { bookIsbnSchema } from '../../../../shared/utils/schemas'
import { BookEditService } from '../../../services/book-edit.service'

export default effectHandler((event, user) => Effect.gen(function* () {
  const body = yield* Effect.tryPromise({
    try: () => readValidatedBody(event, bookIsbnSchema.parse),
    catch: error => createError({ statusCode: 400, message: 'Enter a valid ISBN to find a cover', data: error })
  })
  const service = yield* BookEditService
  return yield* service.previewCover(user.id, getRouterParam(event, 'id')!, body.isbn)
}))
