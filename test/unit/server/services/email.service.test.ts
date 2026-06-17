import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { EmailServiceLive, sendEmail, sendEmailMessage, USER_SAFE_EMAIL_DELIVERY_ERROR } from '../../../../server/services/email.service'
import { EmailServiceSmtpLive } from '../../../../server/runtime/providers/email.smtp'

const { createTransportMock, sendMailMock } = vi.hoisted(() => ({
  createTransportMock: vi.fn(),
  sendMailMock: vi.fn()
}))

vi.mock('nodemailer', () => ({
  default: {
    createTransport: createTransportMock
  }
}))

const envKeys = [
  'NUXT_EMAIL_VERIFICATION_ENABLED',
  'NUXT_EMAIL_PROVIDER',
  'NUXT_EMAIL_FROM',
  'NUXT_EMAIL_REPLY_TO',
  'NUXT_SMTP_HOST',
  'NUXT_SMTP_PORT',
  'NUXT_SMTP_SECURE',
  'NUXT_SMTP_USER',
  'NUXT_SMTP_PASSWORD',
  'NUXT_PLUNK_API_KEY',
  'NUXT_PLUNK_BASE_URL'
]
const originalEnvValues = new Map(envKeys.map(key => [key, process.env[key]]))

describe('EmailService', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    createTransportMock.mockReset()
    sendMailMock.mockReset()
    for (const key of envKeys) {
      const value = originalEnvValues.get(key)
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key)
      } else {
        process.env[key] = value
      }
    }
  })

  it('sends rendered messages through Plunk', async () => {
    process.env.NUXT_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_PROVIDER = 'plunk'
    process.env.NUXT_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.NUXT_EMAIL_REPLY_TO = 'support@example.com'
    process.env.NUXT_PLUNK_API_KEY = 'sk_test'
    process.env.NUXT_PLUNK_BASE_URL = 'https://plunk.example.com/'

    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {}
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await Effect.runPromise(sendEmail({
      to: 'ada@example.com',
      subject: 'Verify your email',
      text: 'Verify with this link',
      html: '<p>Verify with this link</p>'
    }).pipe(
      Effect.provide(EmailServiceLive)
    ))

    expect(fetchMock).toHaveBeenCalledWith('https://plunk.example.com/v1/send', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer sk_test',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: 'ada@example.com',
        from: {
          name: 'Libroo',
          email: 'no-reply@example.com'
        },
        reply: 'support@example.com',
        subject: 'Verify your email',
        body: '<p>Verify with this link</p>'
      }),
      signal: expect.any(AbortSignal)
    })
  })

  it('sends reply-to through SMTP', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'smtp'
    process.env.NUXT_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.NUXT_EMAIL_REPLY_TO = 'support@example.com'
    process.env.NUXT_SMTP_HOST = 'smtp.example.com'
    process.env.NUXT_SMTP_PORT = '465'
    process.env.NUXT_SMTP_SECURE = 'true'
    process.env.NUXT_SMTP_USER = 'smtp-user'
    process.env.NUXT_SMTP_PASSWORD = 'smtp-password'
    createTransportMock.mockReturnValue({ sendMail: sendMailMock })
    sendMailMock.mockResolvedValue({})

    await Effect.runPromise(sendEmail({
      to: 'ada@example.com',
      subject: 'Verify your email',
      text: 'Verify with this link',
      html: '<p>Verify with this link</p>'
    }).pipe(
      Effect.provide(EmailServiceSmtpLive)
    ))

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: {
        user: 'smtp-user',
        pass: 'smtp-password'
      }
    })
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'Libroo <no-reply@example.com>',
      to: 'ada@example.com',
      replyTo: 'support@example.com',
      subject: 'Verify your email',
      text: 'Verify with this link',
      html: '<p>Verify with this link</p>'
    })
  })

  it('surfaces Plunk delivery failures', async () => {
    process.env.NUXT_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_PROVIDER = 'plunk'
    process.env.NUXT_EMAIL_FROM = 'no-reply@example.com'
    process.env.NUXT_PLUNK_API_KEY = 'sk_test'

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid recipient'
      }
    }), { status: 422 })))

    const result = await Effect.runPromise(Effect.either(sendEmail({
      to: 'not-an-email',
      subject: 'Verify your email',
      text: 'Verify with this link'
    }).pipe(
      Effect.provide(EmailServiceLive)
    )))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      _tag: 'EmailDeliveryError',
      message: '[VALIDATION_ERROR] Invalid recipient'
    })
  })

  it('surfaces Plunk billing limits as a clear delivery failure', async () => {
    process.env.NUXT_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_PROVIDER = 'plunk'
    process.env.NUXT_EMAIL_FROM = 'no-reply@example.com'
    process.env.NUXT_PLUNK_API_KEY = 'sk_test'

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: {
        code: 'BILLING_LIMIT_EXCEEDED',
        message: 'Billing limit exceeded'
      }
    }), { status: 402 })))

    const result = await Effect.runPromise(Effect.either(sendEmail({
      to: 'ada@example.com',
      subject: 'Verify your email',
      text: 'Verify with this link'
    }).pipe(
      Effect.provide(EmailServiceLive)
    )))

    expect(result._tag).toBe('Left')
    expect(result.left).toMatchObject({
      _tag: 'EmailDeliveryError',
      message: 'Plunk email sending limit exceeded. Verification email could not be sent; increase the Plunk limit or switch email providers.'
    })
  })

  it('masks provider details in the auth email helper', async () => {
    process.env.NUXT_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_PROVIDER = 'plunk'
    process.env.NUXT_EMAIL_FROM = 'no-reply@example.com'
    process.env.NUXT_PLUNK_API_KEY = 'sk_test'

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: {
        code: 'BILLING_LIMIT_EXCEEDED',
        message: 'Billing limit exceeded'
      }
    }), { status: 402 })))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(sendEmailMessage({
      to: 'ada@example.com',
      subject: 'Verify your email',
      text: 'Verify with this link'
    })).rejects.toThrow(USER_SAFE_EMAIL_DELIVERY_ERROR)

    expect(consoleError).toHaveBeenCalledWith(
      'Email delivery failed:',
      'Plunk email sending limit exceeded. Verification email could not be sent; increase the Plunk limit or switch email providers.'
    )
  })
})
