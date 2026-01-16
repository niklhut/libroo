export default defineNuxtRouteMiddleware(async (to) => {
  // Skip auth check for pages explicitly marked as public
  const isAuthRequired = to.meta.auth !== false
  if (!isAuthRequired) {
    return
  }

  const { data: session } = await authClient.useSession(useFetch)

  // If no session and auth is required, redirect to login
  if (!session.value?.user) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath }
    })
  }
})
