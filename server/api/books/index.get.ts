import { Effect } from 'effect'
import { normalizeLibraryQuery } from '../../../shared/utils/library-query'

// Default pagination values
const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 100

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const filters = normalizeLibraryQuery(getQuery(event), {
      defaultPageSize: DEFAULT_PAGE_SIZE,
      maxPageSize: MAX_PAGE_SIZE
    })

    return yield* getUserLibrary(user.id, filters)
  })
)
