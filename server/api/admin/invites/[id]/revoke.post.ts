import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const inviteId = getRouterParam(event, 'id')

    if (!inviteId) {
      return yield* Effect.fail(new InvalidSignupInviteError({ message: 'Invite id is required' }))
    }

    return yield* revokeSignupInvite(user, inviteId)
  })
)
