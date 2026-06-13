import { afterEach, describe, expect, it } from 'vitest'
import { getEmailVerificationConfig, validateEmailVerificationConfig } from '../../../../server/utils/email-verification-config'

const envKeys = [
  'LIBROO_EMAIL_VERIFICATION_ENABLED',
  'LIBROO_EMAIL_PROVIDER',
  'LIBROO_EMAIL_FROM',
  'LIBROO_SMTP_HOST',
  'LIBROO_SMTP_PORT',
  'LIBROO_SMTP_SECURE',
  'LIBROO_SMTP_USER',
  'LIBROO_SMTP_PASSWORD',
  'LIBROO_PLUNK_API_KEY',
  'LIBROO_PLUNK_BASE_URL'
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
    process.env.LIBROO_EMAIL_VERIFICATION_ENABLED = 'true'

    expect(() => validateEmailVerificationConfig()).toThrow(/Email verification is enabled/)
  })

  it('accepts SMTP settings when enabled', () => {
    process.env.LIBROO_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.LIBROO_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.LIBROO_SMTP_HOST = 'smtp.example.com'
    process.env.LIBROO_SMTP_PORT = '465'
    process.env.LIBROO_SMTP_SECURE = 'true'
    process.env.LIBROO_SMTP_USER = 'user'
    process.env.LIBROO_SMTP_PASSWORD = 'password'

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
    process.env.LIBROO_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.LIBROO_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.LIBROO_SMTP_HOST = 'smtp.example.com'
    process.env.LIBROO_SMTP_PASSWORD = 'password'

    expect(() => validateEmailVerificationConfig()).toThrow(/LIBROO_SMTP_USER/)
  })

  it('accepts Plunk settings when enabled', () => {
    process.env.LIBROO_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.LIBROO_EMAIL_PROVIDER = 'plunk'
    process.env.LIBROO_PLUNK_API_KEY = 'sk_test'
    process.env.LIBROO_PLUNK_BASE_URL = 'https://plunk.example.com'

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
    process.env.LIBROO_EMAIL_VERIFICATION_ENABLED = 'true'
    process.env.LIBROO_EMAIL_PROVIDER = 'plunk'

    expect(() => validateEmailVerificationConfig()).toThrow(/LIBROO_PLUNK_API_KEY/)
  })
})
