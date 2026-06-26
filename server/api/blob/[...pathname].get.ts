import { Effect } from 'effect'

export default effectHandler((event, user) =>
  Effect.gen(function* () {
    const pathname = getRouterParam(event, 'pathname')

    if (!pathname) {
      return yield* Effect.fail(
        createError({
          statusCode: 400,
          message: 'Pathname is required'
        })
      )
    }

    const blobData = yield* getAuthorizedCover(pathname, user).pipe(
      Effect.catchTag('CoverAccessDeniedError', () =>
        Effect.fail(createError({
          statusCode: 404,
          message: 'Cover not found'
        }))
      )
    )

    setHeader(event, 'Content-Type', blobData.type || 'application/octet-stream')
    setHeader(event, 'Cache-Control', 'private, max-age=3600')

    return blobData
  })
)
