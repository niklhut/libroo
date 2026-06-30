import { Effect } from 'effect'
import { normalizeAdminPagination } from '../../../utils/admin-route-input'

export default effectHandler(event =>
  Effect.gen(function* () {
    const query = getQuery(event)

    return yield* listAdminUsers({
      headers: event.headers,
      ...normalizeAdminPagination(query)
    })
  })
)
