import { createError, defineEventHandler, getHeader } from 'h3'
import { verifyCloudflareAccessJwt } from '../utils/cloudflare-access'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  if (config.cloudflarePreview !== 'true') {
    return
  }

  const audience = config.cloudflareAccessAudience
  const teamDomain = config.cloudflareAccessTeamDomain
  if (!audience || !teamDomain) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Preview access protection is not configured'
    })
  }

  const token = getHeader(event, 'cf-access-jwt-assertion')
  if (!token) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cloudflare Access authentication is required'
    })
  }

  try {
    event.context.cloudflareAccess = await verifyCloudflareAccessJwt({
      token,
      audience,
      teamDomain
    })
  } catch {
    throw createError({
      statusCode: 403,
      statusMessage: 'Cloudflare Access authentication is invalid'
    })
  }
})
