import { ref } from 'vue'
import { useAuth } from '~/composables/useAuth'
import { authClient } from '~/utils/auth-client'

export async function initializeAuthSession(server = import.meta.server) {
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
      const result = await useAuth().getSession()

      if (result.error) {
        throw result.error
      }

      session = {
        data: ref(result.data),
        error: ref(null),
        isPending: ref(false)
      }
    } else {
      session = await authClient.useSession(useFetch)
    }
  } catch (error) {
    console.error('Failed to initialize auth session', error)

    session = {
      data: ref(null),
      error: ref(error),
      isPending: ref(false)
    }
  }

  return session
}

export default defineNuxtPlugin(async () => {
  return {
    provide: {
      authSession: await initializeAuthSession()
    }
  }
})
