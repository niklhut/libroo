import { roleIncludesAdmin } from '~~/shared/utils/auth-roles'
import { isActiveBan } from '~~/shared/utils/auth-status'
import { useAuth } from '~/composables/useAuth'
import { authClient } from '~/utils/auth-client'

export default defineNuxtRouteMiddleware(async (to) => {
  // Skip auth check for pages explicitly marked as public
  const isAuthRequired = to.meta.auth !== false
  if (!isAuthRequired) {
    return
  }

  const { $authSession } = useNuxtApp()
  const { data: session } = $authSession

  // If no session and auth is required, redirect to login
  if (!session.value?.user) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath }
    })
  }

  if (isActiveBan(session.value.user)) {
    const client = import.meta.server ? useAuth() : authClient
    await client.signOut().catch(() => undefined)
    session.value = null
    return navigateTo('/login')
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
