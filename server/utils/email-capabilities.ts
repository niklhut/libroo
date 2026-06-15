import type { EmailCapabilities } from '~~/shared/types/email-capabilities'
import { emailDeliveryConfigured, getEmailVerificationConfig } from './email-verification-config'

export function getEmailCapabilities(): EmailCapabilities {
  const verificationConfig = getEmailVerificationConfig()
  const emailSendingEnabled = emailDeliveryConfigured()
  const emailVerificationEnabled = verificationConfig.enabled && emailSendingEnabled

  return {
    emailSendingEnabled,
    emailVerificationEnabled,
    passwordResetEnabled: emailSendingEnabled,
    inviteEmailEnabled: emailSendingEnabled,
    emailChangeVerificationEnabled: emailVerificationEnabled,
    reminderEmailEnabled: emailSendingEnabled
  }
}
