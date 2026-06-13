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
  const uppercaseValue = value.toUpperCase()

  if (uppercaseValue.includes('TOKEN_EXPIRED')) return 'expired'
  if (
    uppercaseValue.includes('INVALID')
    || uppercaseValue.includes('INVALID_TOKEN')
    || uppercaseValue.includes('TOKEN_ALREADY_USED')
  ) {
    return 'invalid'
  }
  return 'failure'
}
