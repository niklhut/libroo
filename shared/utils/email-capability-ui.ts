import type { EmailCapabilities } from '~~/shared/types/email-capabilities'

export interface EmailVerificationUiStatus {
  verified: boolean
  pendingEmail: string | null
}

export function canShowForgotPasswordAction(capabilities: EmailCapabilities) {
  return capabilities.passwordResetEnabled
}

export function getRegistrationSuccessDescription(capabilities: EmailCapabilities) {
  return capabilities.emailVerificationEnabled
    ? 'Check your email to verify your account before signing in.'
    : 'Welcome to Libroo.'
}

export function canUseVerifiedEmailChange(capabilities: EmailCapabilities) {
  return capabilities.emailChangeVerificationEnabled
}

export function canShowVerificationResendAction(
  capabilities: EmailCapabilities,
  status: EmailVerificationUiStatus
) {
  return capabilities.emailVerificationEnabled && (!status.verified || Boolean(status.pendingEmail))
}

export function canShowInviteEmailInput(capabilities: EmailCapabilities) {
  return capabilities.inviteEmailEnabled
}

export function getPasswordUpdatedDescription(capabilities: EmailCapabilities) {
  return capabilities.emailSendingEnabled
    ? 'Libroo will try to send a security notification email.'
    : 'No email notification was sent because email sending is not configured.'
}
