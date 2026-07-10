import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const body = yield* Effect.tryPromise({
      try: () => readBody(event),
      catch: e => createError({ statusCode: 400, message: 'Validation Error', data: e })
    })

    return yield* updateUserPreferences(user.id, body)
  })
)
