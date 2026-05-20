import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const token = getRouterParam(event, 'token')

    if (!token) {
      return yield* Effect.fail(createError({ statusCode: 400, message: 'Invitation token is required' }))
    }

    return yield* acceptBookInvite(token, user.id)
  })
)
