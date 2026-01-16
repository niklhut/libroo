import { authClient } from '~/composables/auth'

export default defineNuxtPlugin(async () => {
  // Initialize better-auth session once at app startup
  // This awaits the promise and stores the reactive session object
  const session = await authClient.useSession(useFetch)

  return {
    provide: {
      // Provide the session directly (not wrapped in useState)
      authSession: session
    }
  }
})
