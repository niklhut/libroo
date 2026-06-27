import { roleIncludesAdmin } from '~~/shared/utils/auth-roles'
import { isActiveBan } from '~~/shared/utils/auth-status'

export default defineNuxtRouteMiddleware(async (to) => {
  // Skip auth check for pages explicitly marked as public
  const isAuthRequired = to.meta.auth !== false
  if (!isAuthRequired) {
    return
  }

  const authStore = useAuthStore()
  const { $authSession } = useNuxtApp()

  // If no session and auth is required, redirect to login
  if (!authStore.user) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath }
    })
  }

  if (isActiveBan(authStore.user)) {
    await authClient.signOut().catch(() => undefined)
    $authSession.data.value = null
    return navigateTo('/login')
  }

  const { data: emailCapabilities, error: emailCapabilitiesError } = await useEmailCapabilities()
  const canUseUnverifiedAccount = to.path === '/settings' || to.path.startsWith('/verify-email')
  const enforceVerificationGate = emailCapabilitiesError.value
    ? true
    : emailCapabilities.value.emailVerificationEnabled
  if (enforceVerificationGate && authStore.user.emailVerified !== true && !canUseUnverifiedAccount) {
    return navigateTo({
      path: '/settings',
      query: { verify: 'required', redirect: to.fullPath }
    })
  }

  if (to.path.startsWith('/admin')) {
    if (!roleIncludesAdmin(authStore.user.role)) {
      return navigateTo('/library')
    }
  }
})
