import { Effect, Layer } from 'effect'
import { getEmailDeliveryConfig, validateEmailDeliveryConfig } from '../../utils/email-verification-config'
import { EmailDeliveryError, EmailService } from '../email.core'
import type { EmailMessage } from '../email.core'

const PLUNK_SEND_TIMEOUT_MS = 5000

export const EmailServicePlunkLive = Layer.succeed(EmailService, {
  sendEmail: message =>
    Effect.tryPromise({
      try: async () => {
        const config = getEmailDeliveryConfig()
        validateEmailDeliveryConfig(config)

        if (config.provider !== 'plunk') {
          throw new Error('Hosted Cloudflare email delivery only supports the Plunk provider')
        }
        if (!config.plunk) {
          throw new Error('Plunk is not configured')
        }

        await sendWithPlunk({
          ...config.plunk,
          from: config.from,
          replyTo: config.replyTo
        }, message)
      },
      catch: error => new EmailDeliveryError({
        message: error instanceof Error ? error.message : 'Unable to send email'
      })
    })
})

export async function sendWithPlunk(
  config: { apiKey: string, baseUrl: string, from: string, replyTo?: string },
  message: EmailMessage
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PLUNK_SEND_TIMEOUT_MS)

  try {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/v1/send`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: message.to,
        from: formatPlunkAddress(config.from),
        ...(config.replyTo ? { reply: config.replyTo } : {}),
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
  } finally {
    clearTimeout(timeout)
  }
}

function formatPlunkAddress(address: string) {
  const trimmed = address.trim()
  const match = trimmed.match(/^"?([^"<]+?)"?\s*<([^>]+)>$/)

  if (!match) return trimmed

  return {
    name: match[1]?.trim(),
    email: match[2]?.trim()
  }
}
