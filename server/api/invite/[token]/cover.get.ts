import { Effect } from 'effect'
import { runEffect } from '../../../utils/effect'

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')

  if (!token) {
    throw createError({ statusCode: 400, message: 'Invitation token is required' })
  }

  return runEffect(
    Effect.gen(function* () {
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
    })
  )
})
