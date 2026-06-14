import { Effect } from 'effect'
import { runEffect } from '../../../utils/effect'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  if (!token) {
    throw createError({ statusCode: 400, message: 'Invitation token is required' })
  }

  return runEffect(
    Effect.gen(function* () {
      const viewerUserId = yield* getOptionalCurrentUserId(event)
      return yield* getInvitePreview(token, viewerUserId)
    })
  )
})
