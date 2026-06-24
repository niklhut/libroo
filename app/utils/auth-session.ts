import { ref } from 'vue'
import { authClient } from '~/utils/auth-client'

type AuthSessionData = Awaited<ReturnType<typeof authClient.getSession>>['data']
type ServerSessionResolver = () => Promise<AuthSessionData>

export async function initializeAuthSession(
  server = import.meta.server,
  serverSessionResolver?: ServerSessionResolver
) {
  const route = useRoute()
  const shouldInitializeSession = !server
    || route.meta.auth !== false
    || route.meta.authSession === true

  if (!shouldInitializeSession) {
    return {
      data: ref(null),
      error: ref(null),
      isPending: ref(false)
    }
  }

  let session
  try {
    if (server) {
      if (!serverSessionResolver) {
        throw new Error('A server session resolver is required during SSR')
      }

      session = {
        data: ref(await serverSessionResolver()),
        error: ref(null),
        isPending: ref(false)
      }
    } else {
      session = await authClient.useSession(useFetch)
    }
  } catch (error) {
    console.error('Failed to initialize auth session', {
      message: getErrorField(error, 'message'),
      status: getErrorField(error, 'status'),
      code: getErrorField(error, 'code'),
      cause: getErrorField(error, 'cause')
    })

    session = {
      data: ref(null),
      error: ref(error),
      isPending: ref(false)
    }
  }

  return session
}

function getErrorField(error: unknown, field: string) {
  if (error && typeof error === 'object' && field in error) {
    return (error as Record<string, unknown>)[field]
  }
}
