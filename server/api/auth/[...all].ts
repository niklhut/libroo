import { Effect } from 'effect'
import { auth } from '../../utils/auth'
import { getEmailVerificationConfig } from '../../utils/email-verification-config'
import { validateEmailVerificationToken } from '../../services/auth.service'
import { runEffect } from '../../utils/effect'

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event)
  const url = new URL(request.url ?? 'http://localhost/api/auth')
  const verificationEnabled = getEmailVerificationConfig().enabled
  const isEmailSignup = url.pathname.endsWith('/api/auth/sign-up/email') && request.method === 'POST'
  let acceptedInviteId: string | null = null

  if (verificationEnabled && url.pathname.endsWith('/api/auth/change-email')) {
    throw createError({
      statusCode: 403,
      message: 'Use account settings to change email'
    })
  }

  if (verificationEnabled && url.pathname.endsWith('/api/auth/verify-email')) {
    const token = url.searchParams.get('token')
    if (token) {
      await runEffect(Effect.gen(function* () {
        return yield* validateEmailVerificationToken(token)
      }))
    }
  }

  if (isEmailSignup) {
    const body = await readSignupBody(request)
    const validation = await runEffect(Effect.gen(function* () {
      return yield* validateSignupAttempt({
        token: body?.inviteToken,
        email: body?.email
      })
    }))
    acceptedInviteId = validation.inviteId
  }

  const response = await auth.handler(request)

  if (isEmailSignup && response.ok && acceptedInviteId) {
    const body = await response.clone().json().catch(() => null) as { user?: { id?: string } } | null
    const userId = body?.user?.id

    if (userId) {
      await runEffect(Effect.gen(function* () {
        return yield* acceptSignupInvite(acceptedInviteId, userId)
      }))
    }
  }

  return response
})

async function readSignupBody(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    return await request.clone().json().catch(() => null) as Record<string, unknown> | null
  }

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.clone().formData().catch(() => null)
    if (!form) return null

    return Object.fromEntries(form.entries())
  }

  return null
}
