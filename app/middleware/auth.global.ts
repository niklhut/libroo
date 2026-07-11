import { roleIncludesAdmin } from '~~/shared/utils/auth-roles'
import { isActiveBan } from '~~/shared/utils/auth-status'

export default defineNuxtRouteMiddleware(async (to) => {
  if (to.matched.length === 0) {
    return
  }

  // Skip auth check for pages explicitly marked as public
  const isAuthRequired = to.meta.auth !== false
  if (!isAuthRequired) {
    return
  }

  const authStore = useAuthStore()

  if (authStore.status === 'error') {
    throw createError({
      statusCode: 503,
      statusMessage: 'Unable to restore session'
    })
  }

  if (authStore.status === 'unauthenticated') {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath }
    })
  }

  const user = authStore.user
  if (!user) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Unable to restore session'
    })
  }

  if (isActiveBan(user)) {
    await authStore.signOut().catch(() => undefined)
    return navigateTo('/login')
  }

  const { data: emailCapabilities, error: emailCapabilitiesError } = await useEmailCapabilities()
  const canUseUnverifiedAccount = to.path === '/settings' || to.path.startsWith('/verify-email')
  const enforceVerificationGate = emailCapabilitiesError.value
    ? true
    : emailCapabilities.value.emailVerificationEnabled
  if (enforceVerificationGate && user.emailVerified !== true && !canUseUnverifiedAccount) {
    return navigateTo({
      path: '/settings',
      query: { verify: 'required', redirect: to.fullPath }
    })
  }

  if (to.path.startsWith('/admin')) {
    if (!roleIncludesAdmin(user.role)) {
      return navigateTo('/library')
    }
  }
})
