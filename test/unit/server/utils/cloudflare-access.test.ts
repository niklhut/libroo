import { beforeEach, describe, expect, it, vi } from 'vitest'
import { JWTExpired, JWKSTimeout } from 'jose/errors'
import {
  CloudflareAccessConfigurationError,
  isCloudflareAccessTokenError,
  verifyCloudflareAccessJwt
} from '../../../../server/utils/cloudflare-access'

const joseMock = vi.hoisted(() => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn()
}))

vi.mock('jose', () => joseMock)

describe('Cloudflare Access JWT verification', () => {
  beforeEach(() => {
    joseMock.createRemoteJWKSet.mockReset()
    joseMock.jwtVerify.mockReset()
  })

  it('verifies the token against the team JWKS, issuer, and application audience', async () => {
    const jwks = { cached: true }
    joseMock.createRemoteJWKSet.mockReturnValue(jwks)
    joseMock.jwtVerify.mockResolvedValue({
      payload: {
        email: 'preview.tester@example.com'
      }
    })

    await expect(verifyCloudflareAccessJwt({
      token: 'access-token',
      audience: 'preview-audience',
      teamDomain: 'https://libroo.cloudflareaccess.com/'
    })).resolves.toEqual({
      email: 'preview.tester@example.com'
    })

    expect(joseMock.createRemoteJWKSet).toHaveBeenCalledWith(
      new URL('https://libroo.cloudflareaccess.com/cdn-cgi/access/certs')
    )
    expect(joseMock.jwtVerify).toHaveBeenCalledWith('access-token', jwks, {
      audience: 'preview-audience',
      issuer: 'https://libroo.cloudflareaccess.com'
    })
  })

  it('rejects a non-HTTPS team domain before attempting verification', async () => {
    await expect(verifyCloudflareAccessJwt({
      token: 'access-token',
      audience: 'preview-audience',
      teamDomain: 'http://libroo.cloudflareaccess.com'
    })).rejects.toBeInstanceOf(CloudflareAccessConfigurationError)

    expect(joseMock.createRemoteJWKSet).not.toHaveBeenCalled()
    expect(joseMock.jwtVerify).not.toHaveBeenCalled()
  })

  it('classifies token failures separately from verifier infrastructure failures', () => {
    expect(isCloudflareAccessTokenError(new JWTExpired('expired', {
      claim: 'exp',
      reason: 'check_failed',
      payload: {}
    }))).toBe(true)
    expect(isCloudflareAccessTokenError(new JWKSTimeout())).toBe(false)
    expect(isCloudflareAccessTokenError(new TypeError('network unavailable'))).toBe(false)
  })
})
