export default defineNuxtRouteMiddleware(async (to) => {
  const { data: session } = await authClient.useSession(useFetch)
  if (!session.value) {
    if (to.meta.auth === false) {
      return navigateTo('/auth/login')
    }
  }
})
