import { Effect } from 'effect'

export default effectHandler(event =>
  Effect.gen(function* () {
    const token = getRouterParam(event, 'token')

    if (!token) {
      return yield* Effect.fail(createError({ statusCode: 400, message: 'Invite token is required' }))
    }

    return yield* getSignupInvitePreview(token)
  }),
{ auth: false })
