import { Effect } from 'effect'

export default effectHandler(event =>
  Effect.gen(function* () {
    const token = getRouterParam(event, 'token')

    if (!token) {
      return yield* Effect.fail(createError({ statusCode: 400, message: 'Invitation token is required' }))
    }

    const viewerUserId = yield* getOptionalCurrentUserId(event)
    return yield* getInvitePreview(token, viewerUserId)
  }),
{ auth: false })
