import { describe, expect, it } from 'vitest'
import {
  canShowForgotPasswordAction,
  canShowInviteEmailInput,
  canShowVerificationResendAction,
  canUseVerifiedEmailChange,
  getPasswordUpdatedDescription,
  getRegistrationSuccessDescription
} from '../../shared/utils/email-capability-ui'
import type { EmailCapabilities } from '../../shared/types/email-capabilities'

const noEmail: EmailCapabilities = {
  emailSendingEnabled: false,
  emailVerificationEnabled: false,
  passwordResetEnabled: false,
  inviteEmailEnabled: false,
  emailChangeVerificationEnabled: false,
  reminderEmailEnabled: false
}

const sendingOnly: EmailCapabilities = {
  ...noEmail,
  emailSendingEnabled: true,
  passwordResetEnabled: true,
  inviteEmailEnabled: true,
  reminderEmailEnabled: true
}

const verificationEnabled: EmailCapabilities = {
  ...sendingOnly,
  emailVerificationEnabled: true,
  emailChangeVerificationEnabled: true
}

describe('email capability UI decisions', () => {
  it('hides email-only actions when email sending is unavailable', () => {
    expect(canShowForgotPasswordAction(noEmail)).toBe(false)
    expect(canShowInviteEmailInput(noEmail)).toBe(false)
    expect(canShowVerificationResendAction(noEmail, { verified: false, pendingEmail: null })).toBe(false)
    expect(canUseVerifiedEmailChange(noEmail)).toBe(false)
  })

  it('shows send-backed actions without implying verification is enabled', () => {
    expect(canShowForgotPasswordAction(sendingOnly)).toBe(true)
    expect(canShowInviteEmailInput(sendingOnly)).toBe(true)
    expect(canShowVerificationResendAction(sendingOnly, { verified: false, pendingEmail: null })).toBe(false)
    expect(getRegistrationSuccessDescription(sendingOnly)).toBe('Welcome to Libroo.')
  })

  it('shows verification actions only for unverified or pending-email states', () => {
    expect(canShowVerificationResendAction(verificationEnabled, { verified: false, pendingEmail: null })).toBe(true)
    expect(canShowVerificationResendAction(verificationEnabled, { verified: true, pendingEmail: 'new@example.com' })).toBe(true)
    expect(canShowVerificationResendAction(verificationEnabled, { verified: true, pendingEmail: null })).toBe(false)
    expect(getRegistrationSuccessDescription(verificationEnabled)).toBe('Check your email to verify your account before signing in.')
  })

  it('distinguishes password update notification copy by sending capability', () => {
    expect(getPasswordUpdatedDescription(noEmail)).toBe('No email notification was sent because email sending is not configured.')
    expect(getPasswordUpdatedDescription(sendingOnly)).toBe('Libroo will try to send a security notification email.')
  })
})
