import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import {
  JOSEAlgNotAllowed,
  JWSInvalid,
  JWSSignatureVerificationFailed,
  JWTClaimValidationFailed,
  JWTExpired,
  JWTInvalid,
  JWKSMultipleMatchingKeys,
  JWKSNoMatchingKey
} from 'jose/errors'

const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export class CloudflareAccessConfigurationError extends Error {}

function normalizeTeamDomain(teamDomain: string) {
  let url: URL
  try {
    url = new URL(teamDomain)
  } catch {
    throw new CloudflareAccessConfigurationError(
      'Cloudflare Access team domain must be a valid URL'
    )
  }
  if (url.protocol !== 'https:') {
    throw new CloudflareAccessConfigurationError(
      'Cloudflare Access team domain must use HTTPS'
    )
  }
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

export function isCloudflareAccessTokenError(error: unknown) {
  return error instanceof JOSEAlgNotAllowed
    || error instanceof JWSInvalid
    || error instanceof JWSSignatureVerificationFailed
    || error instanceof JWTClaimValidationFailed
    || error instanceof JWTExpired
    || error instanceof JWTInvalid
    || error instanceof JWKSMultipleMatchingKeys
    || error instanceof JWKSNoMatchingKey
}

export async function verifyCloudflareAccessJwt(options: {
  token: string
  audience: string
  teamDomain: string
}): Promise<JWTPayload> {
  const teamDomain = normalizeTeamDomain(options.teamDomain)
  let jwks = jwksByTeamDomain.get(teamDomain)

  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`))
    jwksByTeamDomain.set(teamDomain, jwks)
  }

  const { payload } = await jwtVerify(options.token, jwks, {
    audience: options.audience,
    issuer: teamDomain
  })

  return payload
}
