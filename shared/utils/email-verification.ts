export type EmailVerificationPageStatus = 'expired' | 'invalid'

export function getEmailVerificationFailureStatus(error: unknown): EmailVerificationPageStatus {
  const value = typeof error === 'string'
    ? error
    : error && typeof error === 'object'
      ? String(
          ('statusText' in error && error.statusText)
          || ('message' in error && error.message)
          || ('code' in error && error.code)
          || ''
        )
      : ''

  return value.includes('TOKEN_EXPIRED') ? 'expired' : 'invalid'
}
