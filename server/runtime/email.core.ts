import { Context, Data, Effect } from 'effect'

export class EmailDeliveryError extends Data.TaggedError('EmailDeliveryError')<{
  message: string
}> { }

export const USER_SAFE_EMAIL_DELIVERY_ERROR = 'Email delivery is temporarily unavailable. Please try again later or contact the administrator.'

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface EmailServiceInterface {
  sendEmail: (message: EmailMessage) => Effect.Effect<void, EmailDeliveryError>
}

export class EmailService extends Context.Tag('EmailService')<EmailService, EmailServiceInterface>() { }

export const sendEmail = (message: EmailMessage) =>
  Effect.flatMap(EmailService, service => service.sendEmail(message))
