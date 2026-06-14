import { afterEach, describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { EmailServiceLive, sendEmail, sendEmailMessage, USER_SAFE_EMAIL_DELIVERY_ERROR } from '../../../../server/services/email.service'

const envKeys = [
  'NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED',
  'NUXT_EMAIL_PROVIDER',
  'NUXT_PLUNK_API_KEY',
  'NUXT_PLUNK_BASE_URL'
]

describe('EmailService', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    for (const key of envKeys) {
      Reflect.deleteProperty(process.env, key)
    }
  })

  it('sends rendered messages through Plunk', async () => {
    process.env.NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_PROVIDER = 'plunk'
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
        subject: 'Verify your email',
        body: '<p>Verify with this link</p>'
      }),
      signal: expect.any(AbortSignal)
    })
  })

  it('surfaces Plunk delivery failures', async () => {
    process.env.NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_PROVIDER = 'plunk'
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
    process.env.NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_PROVIDER = 'plunk'
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
    process.env.NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_PROVIDER = 'plunk'
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
