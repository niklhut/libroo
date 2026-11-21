import { Effect } from 'effect'
import { normalizeLibraryQuery } from '../../../shared/utils/library-query'

// Default pagination values
const DEFAULT_PAGE_SIZE = 12
const MAX_PAGE_SIZE = 100

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const query = getQuery(event)
    const filters = normalizeLibraryQuery(query, {
      defaultPageSize: DEFAULT_PAGE_SIZE,
      maxPageSize: MAX_PAGE_SIZE
    })

    const shelfIndex = query.layout === 'shelf-index'
    const perShelf = shelfIndex || query.layout === 'shelves'
    const shelf = !shelfIndex && perShelf && typeof query.shelf === 'string' ? query.shelf : undefined
    return yield* getUserLibrary(user.id, { ...filters, ...(perShelf ? { perShelf, ...(shelfIndex ? { shelfIndex } : shelf ? { shelf } : {}) } : {}) })
  })
)
