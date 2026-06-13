export type EmailVerificationPageStatus = 'expired' | 'invalid' | 'failure'

export function getEmailVerificationFailureStatus(error: unknown): EmailVerificationPageStatus {
  const value = typeof error === 'string'
    ? error
    : error && typeof error === 'object'
      ? String(
          ('statusText' in error && error.statusText)
          || ('data' in error && error.data && typeof error.data === 'object' && 'message' in error.data && error.data.message)
          || ('data' in error && error.data && typeof error.data === 'object' && 'statusMessage' in error.data && error.data.statusMessage)
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
    || uppercaseValue.includes('NO LONGER ACTIVE')
  ) {
    return 'invalid'
  }
  return 'failure'
}
