import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    setHeader(event, 'Cache-Control', 'private, no-store')
    return yield* exportLibraryBackup(user.id)
  })
)
