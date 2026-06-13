export type EmailVerificationPageStatus = 'expired' | 'invalid' | 'failure'

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

  if (value.includes('TOKEN_EXPIRED')) return 'expired'
  if (
    value.includes('INVALID')
    || value.includes('INVALID_TOKEN')
    || value.includes('TOKEN_ALREADY_USED')
  ) {
    return 'invalid'
  }
  return 'failure'
}
