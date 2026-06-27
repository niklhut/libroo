import { defineEventHandler } from 'h3'
import { auth } from '../utils/auth'
import {
  AUTH_SESSION_OUTCOMES,
  logAuthSessionResolution,
  summarizeAuthSessionError,
  type AuthSessionResolution
} from '../utils/auth-session-logger'

const STATIC_ASSET_PATTERN = /\.(?:avif|css|gif|ico|jpg|jpeg|js|json|map|mjs|png|svg|txt|webmanifest|webp|woff2?)$/i

export default defineEventHandler(async (event) => {
  if (!shouldResolveAuthSession(event)) {
    event.context.authSession = {
      status: 'unauthenticated',
      session: null
    } satisfies AuthSessionResolution
    return
  }

  try {
    const session = await auth.api.getSession({ headers: event.headers })

    event.context.authSession = {
      status: session ? 'authenticated' : 'unauthenticated',
      session
    } satisfies AuthSessionResolution

    logAuthSessionResolution({
      event,
      outcome: session ? AUTH_SESSION_OUTCOMES.success : AUTH_SESSION_OUTCOMES.unauthenticated
    })
  } catch (error) {
    event.context.authSession = {
      status: 'error',
      session: null,
      error: summarizeAuthSessionError(error)
    } satisfies AuthSessionResolution

    logAuthSessionResolution({
      event,
      outcome: AUTH_SESSION_OUTCOMES.failure,
      error
    })
  }
})

export function shouldResolveAuthSession(event: { method?: string, path?: string, headers: Headers }) {
  const method = event.method ?? 'GET'
  const path = event.path ?? '/'

  if (method !== 'GET' && method !== 'HEAD') return false
  if (path.startsWith('/api/')) return false
  if (path.startsWith('/_nuxt/') || path.startsWith('/__nuxt') || path.startsWith('/_ipx/')) return false
  if (STATIC_ASSET_PATTERN.test(path)) return false

  const accept = event.headers.get('accept') ?? ''
  const fetchDestination = event.headers.get('sec-fetch-dest') ?? ''
  const acceptsDocument = accept.includes('text/html')
    || (accept.includes('*/*') && fetchDestination === 'document')
  if (!acceptsDocument) return false

  return true
}
