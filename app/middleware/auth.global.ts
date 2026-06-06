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

  if (isActiveBan(session.value.user)) {
    await authClient.signOut().catch(() => undefined)
    session.value = null
    return navigateTo('/login')
  }

  if (to.path.startsWith('/admin')) {
    const role = session.value.user.role
    const roles = typeof role === 'string' ? role.split(',').map(part => part.trim()) : []
    if (!roles.includes('admin')) {
      return navigateTo('/library')
    }
  }
})

function isActiveBan(user: { banned?: boolean | null, banExpires?: string | Date | null }) {
  if (!user.banned) return false
  if (!user.banExpires) return true

  const banExpires = user.banExpires instanceof Date ? user.banExpires : new Date(user.banExpires)
  return !Number.isFinite(banExpires.getTime()) || banExpires.getTime() > Date.now()
}
