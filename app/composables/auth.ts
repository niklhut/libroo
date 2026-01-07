import { createAuthClient } from 'better-auth/vue'

export const authClient = createAuthClient({
})

export const useAuth = () => {
  const session = authClient.useSession()

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
    return authClient.signOut()
  }

  return {
    session,
    signIn,
    signUp,
    signOut
  }
}
