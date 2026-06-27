import { computed, ref, unref, watchEffect } from 'vue'
import type { AuthSessionResolution, SafeAuthSessionError } from '~~/server/utils/auth-session-logger'

type AuthSessionStatus = AuthSessionResolution['status']
type AuthSessionData = AuthSessionResolution['session']

interface AuthSessionState {
  status: AuthSessionStatus
  data: AuthSessionData
  error: SafeAuthSessionError | null
}

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

  if (import.meta.client) {
    isPending.value = true

    try {
      const { authClient } = await import('~/utils/auth-client')
      const liveSession = await authClient.useSession()

      watchEffect(() => {
        const liveSnapshot = unref(liveSession)
        const pending = liveSnapshot.isPending ?? false
        isPending.value = pending
        const liveError = liveSnapshot.error

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

        const liveData = liveSnapshot.data ?? null
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
        isPending
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

  return {
    name: typeof error,
    message: String(error)
  }
}
