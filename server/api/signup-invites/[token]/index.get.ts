import { Effect } from 'effect'
import { runEffect } from '../../../utils/effect'

export default defineEventHandler((event) => {
  const token = getRouterParam(event, 'token')

  if (!token) {
    throw createError({ statusCode: 400, message: 'Invite token is required' })
  }

  return runEffect(Effect.gen(function* () {
    return yield* getSignupInvitePreview(token)
  }))
})
