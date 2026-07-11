import { describe, expect, it } from 'vitest'
import { GLOBAL_REQUEST_BODY_MAX_BYTES } from '../../../../server/middleware/00.body-limit'

describe('server/middleware/00.body-limit', () => {
  it.each(['/api/books/manual', '/api/books/bulk-add', '/api/library/import'])('rejects oversized requests for %s', async (path) => {
    await expect(runMiddleware(makeEvent(path, 'POST', GLOBAL_REQUEST_BODY_MAX_BYTES + 1))).rejects.toMatchObject({
      statusCode: 413,
      message: 'Payload Too Large'
    })
  })

  it('allows requests at or below the cap', async () => {
    await expect(runMiddleware(makeEvent('/api/books/manual', 'POST', GLOBAL_REQUEST_BODY_MAX_BYTES))).resolves.toBeUndefined()
    await expect(runMiddleware(makeEvent('/api/books/manual', 'POST', GLOBAL_REQUEST_BODY_MAX_BYTES - 1))).resolves.toBeUndefined()
  })

  it('does not apply to body-less methods or exempt asset paths', async () => {
    await expect(runMiddleware(makeEvent('/api/books/manual', 'GET', GLOBAL_REQUEST_BODY_MAX_BYTES + 1))).resolves.toBeUndefined()
    await expect(runMiddleware(makeEvent('/api/books/manual', 'HEAD', GLOBAL_REQUEST_BODY_MAX_BYTES + 1))).resolves.toBeUndefined()
    await expect(runMiddleware(makeEvent('/_nuxt/app.js', 'POST', GLOBAL_REQUEST_BODY_MAX_BYTES + 1))).resolves.toBeUndefined()
  })
})

async function runMiddleware(event: ReturnType<typeof makeEvent>) {
  const middleware = await import('../../../../server/middleware/00.body-limit')
  await middleware.default(event as never)
}

function makeEvent(path: string, method: string, contentLength: number) {
  return {
    path,
    method,
    headers: new Headers({ 'content-length': String(contentLength) }),
    node: {
      req: {
        headers: { 'content-length': String(contentLength) }
      }
    }
  }
}
