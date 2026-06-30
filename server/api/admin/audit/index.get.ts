import { Effect } from 'effect'
import { normalizeAdminPagination, normalizeOptionalString } from '../../../utils/admin-route-input'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const query = getQuery(event)
    const pagination = normalizeAdminPagination(query)

    return yield* listAdminAuditEntries({
      actor: user,
      ...pagination,
      category: normalizeOptionalString(query.category)
    })
  })
)
