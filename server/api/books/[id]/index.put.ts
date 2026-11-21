import { Effect } from 'effect'
import { bookEditSchema } from '../../../../shared/utils/schemas'
import { BookEditService } from '../../../services/book-edit.service'

export default effectHandler((event, user) => Effect.gen(function* () {
  const body = yield* Effect.tryPromise({
    try: () => readValidatedBody(event, bookEditSchema.parse),
    catch: error => createError({ statusCode: 400, message: 'Check the book fields', data: error })
  })
  const service = yield* BookEditService
  return yield* service.save(user.id, getRouterParam(event, 'id')!, body)
}))
