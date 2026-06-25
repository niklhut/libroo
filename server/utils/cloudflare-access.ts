import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

const jwksByTeamDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function normalizeTeamDomain(teamDomain: string) {
  const url = new URL(teamDomain)
  if (url.protocol !== 'https:') {
    throw new Error('Cloudflare Access team domain must use HTTPS')
  }
  url.pathname = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
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
