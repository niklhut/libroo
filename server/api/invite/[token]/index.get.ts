import { Effect } from 'effect'
import { runEffect } from '../../../utils/effect'
import { auth } from '../../../utils/auth'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  if (!token) {
    throw createError({ statusCode: 400, message: 'Invitation token is required' })
  }

  const session = await Promise.resolve(auth.api.getSession({ headers: event.headers })).catch(() => null)

  return runEffect(
    Effect.gen(function* () {
      return yield* getInvitePreview(token, session?.user.id ?? null)
    })
  )
})
