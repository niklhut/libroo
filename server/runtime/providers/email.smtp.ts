import nodemailer from 'nodemailer'
import { Effect, Layer } from 'effect'
import { getEmailDeliveryConfig, validateEmailDeliveryConfig } from '../../utils/email-verification-config'
import { EmailDeliveryError, EmailService } from '../email.core'
import { sendWithPlunk } from './email.plunk'

export const EmailServiceSmtpLive = Layer.succeed(EmailService, {
  sendEmail: message =>
    Effect.tryPromise({
      try: async () => {
        const config = getEmailDeliveryConfig()
        validateEmailDeliveryConfig(config)

        if (config.provider === 'plunk') {
          if (!config.plunk) {
            throw new Error('Plunk is not configured')
          }

          await sendWithPlunk({
            ...config.plunk,
            from: config.from,
            replyTo: config.replyTo
          }, message)
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
          replyTo: config.replyTo || undefined,
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
