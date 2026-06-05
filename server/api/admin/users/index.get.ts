import { Effect } from 'effect'

export default effectHandler(event =>
  Effect.gen(function* () {
    const query = getQuery(event)

    return yield* listAdminUsers({
      headers: event.headers,
      page: query.page,
      pageSize: query.pageSize
    })
  })
)
