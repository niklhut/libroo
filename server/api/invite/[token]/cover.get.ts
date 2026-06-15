import { Effect } from 'effect'

export default effectHandler(event =>
  Effect.gen(function* () {
    const token = getRouterParam(event, 'token')

    if (!token) {
      return yield* Effect.fail(createError({ statusCode: 400, message: 'Invitation token is required' }))
    }

    const preview = yield* getInvitePreview(token)

    if (!preview.coverPath) {
      return yield* Effect.fail(createError({ statusCode: 404, message: 'Cover not found' }))
    }

    const blobData = yield* getBlob(preview.coverPath)

    if (!blobData) {
      return yield* Effect.fail(createError({ statusCode: 404, message: 'Cover not found' }))
    }

    setHeader(event, 'Content-Type', blobData.type || 'application/octet-stream')
    setHeader(event, 'Cache-Control', 'private, max-age=3600')

    return blobData
  }),
{ auth: false })
