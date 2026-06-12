import nodemailer from 'nodemailer'
import { Context, Data, Effect, Layer } from 'effect'
import { getEmailVerificationConfig, validateEmailVerificationConfig } from '../utils/email-verification-config'

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

export const EmailServiceLive = Layer.succeed(EmailService, {
  sendEmail: message =>
    Effect.tryPromise({
      try: async () => {
        const config = getEmailVerificationConfig()
        validateEmailVerificationConfig(config)

        if (config.provider === 'plunk') {
          if (!config.plunk) {
            throw new Error('Plunk is not configured')
          }

          await sendWithPlunk(config.plunk, message)
          return
        }

        if (!config.smtp) {
          throw new Error('SMTP is not configured')
        }
        const transport = nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.secure,
          auth: config.smtp.user
            ? {
                user: config.smtp.user,
                pass: config.smtp.password
              }
            : undefined
        })

        await transport.sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html
        })
      },
      catch: error => new EmailDeliveryError({
        message: error instanceof Error ? error.message : 'Unable to send email'
      })
    })
})

async function sendWithPlunk(
  config: { apiKey: string, baseUrl: string },
  message: EmailMessage
) {
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/v1/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      to: message.to,
      subject: message.subject,
      body: message.html ?? message.text
    })
  })

  const body = await response.json().catch(() => null) as {
    success?: boolean
    error?: {
      code?: string
      message?: string
    }
  } | null

  if (!response.ok || body?.success === false) {
    if (response.status === 402 || body?.error?.code === 'BILLING_LIMIT_EXCEEDED') {
      throw new Error('Plunk email sending limit exceeded. Verification email could not be sent; increase the Plunk limit or switch email providers.')
    }

    const code = body?.error?.code ? `[${body.error.code}] ` : ''
    throw new Error(`${code}${body?.error?.message ?? 'Plunk email delivery failed'}`)
  }
}

export const sendEmail = (message: EmailMessage) =>
  Effect.flatMap(EmailService, service => service.sendEmail(message))

export async function sendEmailMessage(message: EmailMessage) {
  const result = await Effect.runPromise(Effect.either(sendEmail(message).pipe(
    Effect.provide(EmailServiceLive)
  )))

  if (result._tag === 'Left') {
    console.error('Email delivery failed:', result.left.message)
    throw new Error(USER_SAFE_EMAIL_DELIVERY_ERROR)
  }
}
