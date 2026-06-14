import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readBody(event),
      catch: () => new InvalidSignupInviteError({ message: 'Invalid invite request body' })
    })

    return yield* createSignupInvite(user, body)
  })
)
