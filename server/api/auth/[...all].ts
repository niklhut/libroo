import { Effect } from 'effect'
import { getRequestIP, toWebRequest } from 'h3'
import { LIBROO_CLIENT_IP_HEADER } from '../../utils/auth'
import { handleAuthRequest } from '../../services/auth-request.service'
import { effectHandler } from '../../utils/effectHandler'

export default effectHandler(event =>
  Effect.gen(function* () {
    const request = withResolvedClientIp(toWebRequest(event), getRequestIP(event))
    return yield* handleAuthRequest(request)
  }), { auth: false })

function withResolvedClientIp(request: Request, clientIp: string | undefined) {
  if (!clientIp && !request.headers.has(LIBROO_CLIENT_IP_HEADER)) return request

  const headers = new Headers(request.headers)
  if (clientIp) {
    headers.set(LIBROO_CLIENT_IP_HEADER, clientIp)
  } else {
    headers.delete(LIBROO_CLIENT_IP_HEADER)
  }

  return new Request(request, { headers })
}
