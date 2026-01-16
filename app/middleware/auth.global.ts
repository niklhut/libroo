export default defineNuxtRouteMiddleware(async (to) => {
  // Skip auth check for pages explicitly marked as public
  const isAuthRequired = to.meta.auth !== false
  if (!isAuthRequired) {
    return
  }

  const { user } = useAuth()

  // If no session and auth is required, redirect to login
  if (!user.value) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath }
    })
  }
})
