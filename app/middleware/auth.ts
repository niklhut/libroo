export default defineNuxtRouteMiddleware(async (to) => {
  const { session } = useAuth()

  // If no session data value, redirect to login
  if (!session.value?.data?.user) {
    return navigateTo('/auth/login')
  }
})
