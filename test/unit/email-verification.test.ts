import { describe, expect, it } from 'vitest'
import { getEmailVerificationFailureStatus } from '../../shared/utils/email-verification'

describe('email verification status mapping', () => {
  it('maps expired token errors to the expired state', () => {
    expect(getEmailVerificationFailureStatus({ statusText: 'token_expired' })).toBe('expired')
    expect(getEmailVerificationFailureStatus({
      message: 'Request failed with status code 401',
      data: { message: 'TOKEN_EXPIRED' }
    })).toBe('expired')
  })

  it('maps invalid and already-used token errors to the invalid state', () => {
    expect(getEmailVerificationFailureStatus({ statusText: 'invalid_token' })).toBe('invalid')
    expect(getEmailVerificationFailureStatus({ code: 'TOKEN_ALREADY_USED' })).toBe('invalid')
    expect(getEmailVerificationFailureStatus({
      message: 'Request failed with status code 401',
      data: { message: 'This email change link is no longer active.' }
    })).toBe('invalid')
  })

  it('maps unknown failures to the failure state', () => {
    expect(getEmailVerificationFailureStatus({ statusText: 'INTERNAL_SERVER_ERROR' })).toBe('failure')
  })
})
