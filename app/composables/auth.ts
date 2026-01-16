import { createAuthClient } from 'better-auth/vue'

export const authClient = createAuthClient()

// Type for the session returned by better-auth's useSession
type BetterAuthSession = Awaited<ReturnType<typeof authClient.useSession>>

export const useAuth = () => {
  // Get the session from the plugin via useNuxtApp()
  // The plugin initializes useSession(useFetch) once at app startup and provides it
  const { $authSession } = useNuxtApp()
  const session = $authSession as BetterAuthSession

  // Derived computed refs for convenience
  const user = computed(() => session.data.value?.user ?? null)
  const userSession = computed(() => session.data.value?.session ?? null)
  const isAuthenticated = computed(() => !!session.data.value?.user)
  const isPending = computed(() => {
    const pending = session.isPending
    // unref handles both Ref<boolean> and plain boolean
    return unref(pending) ?? true
  })
  const error = computed(() => session.error.value ?? null)

  const signIn = async (email: string, password: string) => {
    return authClient.signIn.email({
      email,
      password
    })
  }

  const signUp = async (email: string, password: string, name: string) => {
    return authClient.signUp.email({
      email,
      password,
      name
    })
  }

  const signOut = async () => {
    await authClient.signOut()
  }

  return {
    user,
    session: userSession,
    isAuthenticated,
    isPending,
    error,
    signIn,
    signUp,
    signOut
  }
}
