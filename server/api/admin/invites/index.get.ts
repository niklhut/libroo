import { Effect } from 'effect'
import { normalizeAdminPagination } from '../../../utils/admin-route-input'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const query = getQuery(event)

    return yield* listSignupInvites(user, normalizeAdminPagination(query))
  })
)
