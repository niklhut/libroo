import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const query = getQuery(event)

    return yield* listSignupInvites(user, {
      page: query.page,
      pageSize: query.pageSize
    })
  })
)
