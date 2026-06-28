import { computed, ref, unref, watchEffect } from 'vue'
import type { AuthSessionResolution, SafeAuthSessionError } from '~~/server/utils/auth-session-logger'

type AuthSessionStatus = AuthSessionResolution['status']
type AuthSessionData = AuthSessionResolution['session']

interface AuthSessionState {
  status: AuthSessionStatus
  data: AuthSessionData
  error: SafeAuthSessionError | null
}

type AuthSessionRefetch = () => Promise<void>

export default defineNuxtPlugin(async () => {
  const event = import.meta.server ? useRequestEvent() : undefined
  const resolvedSession = event?.context.authSession as AuthSessionResolution | undefined
  const authState = useState<AuthSessionState>('auth:session', () => ({
    status: resolvedSession?.status ?? 'unauthenticated',
    data: resolvedSession?.session ?? null,
    error: resolvedSession?.error ?? null
  }))
  const isPending = ref(false)

  const data = computed({
    get: () => authState.value.data,
    set: (value) => {
      authState.value = {
        status: value ? 'authenticated' : 'unauthenticated',
        data: value,
        error: null
      }
    }
  })
  const error = computed(() => authState.value.error)
  let refetch: AuthSessionRefetch = async () => undefined
  const refetchSession: AuthSessionRefetch = async () => refetch()

  if (import.meta.client) {
    isPending.value = true

    try {
      const { authClient } = await import('~/utils/auth-client')
      const liveSession = authClient.useSession()
      refetch = async () => {
        const { refetch } = unref(liveSession)
        await refetch()
      }

      watchEffect(() => {
        const {
          data: liveData = null,
          error: liveError,
          isPending: pending = false
        } = unref(liveSession)
        isPending.value = pending

        if (liveError) {
          authState.value = {
            status: 'error',
            data: null,
            error: normalizeClientSessionError(liveError)
          }
          return
        }

        if (pending) {
          return
        }

        authState.value = {
          status: liveData ? 'authenticated' : 'unauthenticated',
          data: liveData,
          error: null
        }
      })
    } catch (sessionError) {
      isPending.value = false
      authState.value = {
        status: 'error',
        data: null,
        error: normalizeClientSessionError(sessionError)
      }
    }
  }

  return {
    provide: {
      authSession: {
        data,
        error,
        isPending,
        refetch: refetchSession
      }
    }
  }
})

function normalizeClientSessionError(error: unknown): SafeAuthSessionError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message
    }
  }

  if (error && typeof error === 'object') {
    const candidate = error as {
      name?: unknown
      message?: unknown
      status?: unknown
      statusCode?: unknown
    }

    return {
      name: typeof candidate.name === 'string' ? candidate.name : 'Error',
      message: typeof candidate.message === 'string' ? candidate.message : String(error),
      ...(typeof candidate.status === 'number'
        ? { status: candidate.status }
        : typeof candidate.statusCode === 'number'
          ? { status: candidate.statusCode }
          : {})
    }
  }

  return {
    name: typeof error,
    message: String(error)
  }
}
