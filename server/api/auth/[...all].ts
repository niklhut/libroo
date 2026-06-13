import { getEmailVerificationConfig } from '../../utils/email-verification-config'

export default defineEventHandler((event) => {
  const request = toWebRequest(event)
  if (getEmailVerificationConfig().enabled && new URL(request.url).pathname.endsWith('/api/auth/change-email')) {
    throw createError({
      statusCode: 403,
      message: 'Use account settings to change email'
    })
  }

  return auth.handler(request)
})
