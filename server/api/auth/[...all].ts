import { Effect } from 'effect'
import { auth } from '../../utils/auth'
import { getEmailVerificationConfig } from '../../utils/email-verification-config'
import { validateEmailVerificationToken } from '../../services/auth.service'
import { runEffect } from '../../utils/effect'

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event)
  const url = new URL(request.url ?? 'http://localhost/api/auth')
  const verificationEnabled = getEmailVerificationConfig().enabled

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

  return auth.handler(request)
})
