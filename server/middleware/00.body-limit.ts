import { createError, defineEventHandler, getHeader } from 'h3'

export const GLOBAL_REQUEST_BODY_MAX_BYTES = 12 * 1024 * 1024

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const EXEMPT_PATH_PREFIXES = ['/_nuxt/', '/__nuxt', '/_ipx/']

export function shouldEnforceBodyLimit(event: { method?: string, path?: string }) {
  if (!BODY_METHODS.has(event.method ?? 'GET')) return false
  return !EXEMPT_PATH_PREFIXES.some(prefix => (event.path ?? '/').startsWith(prefix))
}

export default defineEventHandler((event) => {
  if (!shouldEnforceBodyLimit(event)) return

  // h3@1.15.11 has no built-in bodyLimit/assertBodySize (those are h3 v2 APIs).
  // Content-Length is only a fast-path hint; cover-specific encoded/decoded checks
  // remain authoritative for chunked or spoofed requests.
  const contentLength = Number(getHeader(event, 'content-length'))
  if (Number.isFinite(contentLength) && contentLength > GLOBAL_REQUEST_BODY_MAX_BYTES) {
    throw createError({ statusCode: 413, message: 'Payload Too Large' })
  }
})
