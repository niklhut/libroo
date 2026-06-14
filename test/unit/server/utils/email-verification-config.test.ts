import { afterEach, describe, expect, it } from 'vitest'
import { getEmailVerificationConfig, validateEmailVerificationConfig } from '../../../../server/utils/email-verification-config'

const envKeys = [
  'NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED',
  'NUXT_EMAIL_PROVIDER',
  'NUXT_EMAIL_FROM',
  'NUXT_SMTP_HOST',
  'NUXT_SMTP_PORT',
  'NUXT_SMTP_SECURE',
  'NUXT_SMTP_USER',
  'NUXT_SMTP_PASSWORD',
  'NUXT_PLUNK_API_KEY',
  'NUXT_PLUNK_BASE_URL'
]

describe('email verification config', () => {
  afterEach(() => {
    for (const key of envKeys) {
      Reflect.deleteProperty(process.env, key)
    }
  })

  it('is disabled by default', () => {
    expect(getEmailVerificationConfig()).toMatchObject({
      enabled: false,
      provider: 'smtp',
      smtp: null
    })
  })

  it('fails loudly when enabled without delivery settings', () => {
    process.env.NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED = 'true'

    expect(() => validateEmailVerificationConfig()).toThrow(/Email verification is enabled/)
  })

  it('accepts SMTP settings when enabled', () => {
    process.env.NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.NUXT_SMTP_HOST = 'smtp.example.com'
    process.env.NUXT_SMTP_PORT = '465'
    process.env.NUXT_SMTP_SECURE = 'true'
    process.env.NUXT_SMTP_USER = 'user'
    process.env.NUXT_SMTP_PASSWORD = 'password'

    expect(getEmailVerificationConfig()).toEqual({
      enabled: true,
      provider: 'smtp',
      from: 'Libroo <no-reply@example.com>',
      smtp: {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        user: 'user',
        password: 'password'
      },
      plunk: null
    })
    expect(() => validateEmailVerificationConfig()).not.toThrow()
  })

  it('requires SMTP credentials as a pair', () => {
    process.env.NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.NUXT_SMTP_HOST = 'smtp.example.com'
    process.env.NUXT_SMTP_PASSWORD = 'password'

    expect(() => validateEmailVerificationConfig()).toThrow(/NUXT_SMTP_USER/)
  })

  it('accepts Plunk settings when enabled', () => {
    process.env.NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_PROVIDER = 'plunk'
    process.env.NUXT_PLUNK_API_KEY = 'sk_test'
    process.env.NUXT_PLUNK_BASE_URL = 'https://plunk.example.com'

    expect(getEmailVerificationConfig()).toEqual({
      enabled: true,
      provider: 'plunk',
      from: '',
      smtp: null,
      plunk: {
        apiKey: 'sk_test',
        baseUrl: 'https://plunk.example.com'
      }
    })
    expect(() => validateEmailVerificationConfig()).not.toThrow()
  })

  it('fails loudly when Plunk is selected without an API key', () => {
    process.env.NUXT_PUBLIC_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.NUXT_EMAIL_PROVIDER = 'plunk'

    expect(() => validateEmailVerificationConfig()).toThrow(/NUXT_PLUNK_API_KEY/)
  })
})
