// export default defineNuxtRouteMiddleware(async (to, from) => {
//   if (import.meta.server) {
//     const session = await auth.api.getSession({
//       headers: useRequestHeaders()
//     })

//     if (!session?.user) {
//       return navigateTo('/auth/login')
//     }
//   } else {
//     const session = await authClient.getSession()
//     if (!session?.data?.user) {
//       return navigateTo('/auth/login')
//     }
//   }
// })

export default defineNuxtRouteMiddleware(async (to, from) => {
  const { data: session } = await authClient.useSession(useFetch);
  if (!session.value) {
    if (to.meta.auth === false) {
      return navigateTo("/auth/login");
    }
  }
});