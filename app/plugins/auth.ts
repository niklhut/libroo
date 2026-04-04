import { authClient } from '~/composables/auth'

export default defineNuxtPlugin(async () => {
  let session
  try {
    // Initialize better-auth session once at app startup
    // This awaits the promise and stores the reactive session object
    session = await authClient.useSession(useFetch)
  } catch (error) {
    console.error('Failed to initialize auth session', error)

    session = {
      data: ref(null),
      error: ref(null),
      isPending: ref(false)
    }
  }

  return {
    provide: {
      authSession: session
    }
  }
})
