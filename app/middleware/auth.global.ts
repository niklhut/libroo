import { roleIncludesAdmin } from '~~/shared/utils/auth-roles'
import { isActiveBan } from '~~/shared/utils/auth-status'

export default defineNuxtRouteMiddleware(async (to) => {
  // Skip auth check for pages explicitly marked as public
  const isAuthRequired = to.meta.auth !== false
  if (!isAuthRequired) {
    return
  }

  const authClient = useAuth()
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
    return navigateTo({
      path: '/login',
      query: { signout: 'true' }
    })
  }

  const { data: emailCapabilities, error: emailCapabilitiesError } = await useEmailCapabilities()
  const canUseUnverifiedAccount = to.path === '/settings' || to.path.startsWith('/verify-email')
  const enforceVerificationGate = emailCapabilitiesError.value
    ? true
    : emailCapabilities.value.emailVerificationEnabled
  if (enforceVerificationGate && session.value.user.emailVerified !== true && !canUseUnverifiedAccount) {
    return navigateTo({
      path: '/settings',
      query: { verify: 'required', redirect: to.fullPath }
    })
  }

  if (to.path.startsWith('/admin')) {
    if (!roleIncludesAdmin(session.value.user.role)) {
      return navigateTo('/library')
    }
  }
})
