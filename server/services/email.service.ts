import { Effect } from 'effect'
import { EmailServiceLive } from '../runtime/email.active'
import { sendEmail, USER_SAFE_EMAIL_DELIVERY_ERROR } from '../runtime/email.core'
import type { EmailMessage } from '../runtime/email.core'

export {
  EmailDeliveryError,
  EmailService,
  sendEmail,
  USER_SAFE_EMAIL_DELIVERY_ERROR
} from '../runtime/email.core'
export type {
  EmailMessage,
  EmailServiceInterface
} from '../runtime/email.core'
export { EmailServiceLive }

export async function sendEmailMessage(message: EmailMessage) {
  const result = await Effect.runPromise(Effect.either(sendEmail(message).pipe(
    Effect.provide(EmailServiceLive)
  )))

  if (result._tag === 'Left') {
    console.error('Email delivery failed:', result.left.message)
    throw new Error(USER_SAFE_EMAIL_DELIVERY_ERROR)
  }
}
