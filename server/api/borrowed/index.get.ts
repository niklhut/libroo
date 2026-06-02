import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    return yield* listBooksLentToUser(user.id)
  })
)
