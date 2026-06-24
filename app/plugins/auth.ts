import { ref } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { authClient } from '~/utils/auth-client'

export default defineNuxtPlugin(async () => {
  const route = useRoute()
  const shouldInitializeSession = import.meta.client
    || route.meta.auth !== false
    || route.meta.authSession === true

  if (!shouldInitializeSession) {
    return {
      provide: {
        authSession: {
          data: ref(null),
          error: ref(null),
          isPending: ref(false)
        }
      }
    }
  }

  let session
  try {
    const client = import.meta.server ? useAuth() : authClient
    session = await client.useSession(useFetch)
  } catch (error) {
    console.error('Failed to initialize auth session', error)

    session = {
      data: ref(null),
      error: ref(error),
      isPending: ref(false)
    }
  }

  return {
    provide: {
      authSession: session
    }
  }
})
