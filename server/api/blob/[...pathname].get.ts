import { Effect } from 'effect'

export default effectHandler(event =>
  Effect.gen(function* () {
    // Get the blob pathname from the URL
    const pathname = getRouterParam(event, 'pathname')

    if (!pathname) {
      return yield* Effect.fail(
        createError({
          statusCode: 400,
          message: 'Pathname is required'
        })
      )
    }

    // Get the blob using Effect
    const blobData = yield* getBlob(pathname)

    if (!blobData) {
      return yield* Effect.fail(
        createError({
          statusCode: 404,
          message: 'Blob not found'
        })
      )
    }

    // Set content type if available
    setHeader(event, 'Content-Type', blobData.type || 'application/octet-stream')
    setHeader(event, 'Cache-Control', 'private, no-cache, no-store, must-revalidate')

    // Return the blob
    return blobData
  })
)
