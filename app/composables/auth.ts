import { createAuthClient } from 'better-auth/vue'

export const authClient = createAuthClient()

export const useAuth = () => {
  // Get the session from the plugin via useNuxtApp()
  // The plugin initializes useSession(useFetch) once at app startup and provides it
  const { $authSession } = useNuxtApp()
  const session = $authSession

  // Derived computed refs for convenience
  const user = computed(() => unref(session.data)?.user ?? null)
  const userSession = computed(() => unref(session.data)?.session ?? null)
  const isAuthenticated = computed(() => !!unref(session.data)?.user)
  const isPending = computed(() => {
    const pending = session.isPending
    // unref handles both Ref<boolean> and plain boolean
    return unref(pending) ?? true
  })
  const error = computed(() => unref(session.error) ?? null)

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
