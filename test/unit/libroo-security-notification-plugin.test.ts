import { afterEach, describe, expect, it, vi } from 'vitest'
import { librooSecurityNotificationPlugin, notifyPasswordChanged, sendPasswordChangedNotification } from '../../server/utils/libroo-security-notification-plugin'
import { sendEmailMessage } from '../../server/services/email.service'

vi.mock('../../server/services/email.service', () => ({
  sendEmailMessage: vi.fn()
}))

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.clearAllMocks()
})

describe('librooSecurityNotificationPlugin', () => {
  it('watches admin set-password alongside user password changes', () => {
    const plugin = librooSecurityNotificationPlugin()
    const beforeMatcher = plugin.hooks?.before?.[0]?.matcher
    const afterMatcher = plugin.hooks?.after?.[0]?.matcher

    expect(beforeMatcher?.({ path: '/change-password' })).toBe(true)
    expect(beforeMatcher?.({ path: '/admin/set-user-password' })).toBe(true)
    expect(afterMatcher?.({ path: '/change-password' })).toBe(true)
    expect(afterMatcher?.({ path: '/admin/set-user-password' })).toBe(true)
  })

  it('skips password notifications when email delivery is not configured', async () => {
    delete process.env.NUXT_EMAIL_FROM
    delete process.env.NUXT_SMTP_HOST

    await expect(notifyPasswordChanged({
      path: '/change-password',
      context: {
        returned: { status: true }
      }
    })).resolves.toBe(false)

    expect(sendEmailMessage).not.toHaveBeenCalled()
  })

  it('sends password-changed notifications without sensitive values', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'smtp'
    process.env.NUXT_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.NUXT_SMTP_HOST = 'smtp.example.com'
    delete process.env.NUXT_SMTP_USER
    delete process.env.NUXT_SMTP_PASSWORD

    await expect(sendPasswordChangedNotification({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com'
    })).resolves.toBe(true)

    expect(sendEmailMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ada@example.com',
      subject: 'Your Libroo password was changed'
    }))
    const message = vi.mocked(sendEmailMessage).mock.calls[0]![0]
    expect(message.text).not.toContain('new-password')
    expect(message.html).not.toContain('new-password')
  })

  it('does not notify when the endpoint returned an unsuccessful status flag', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'smtp'
    process.env.NUXT_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.NUXT_SMTP_HOST = 'smtp.example.com'

    await expect(notifyPasswordChanged({
      path: '/change-password',
      context: {
        returned: { status: false }
      }
    })).resolves.toBe(false)

    expect(sendEmailMessage).not.toHaveBeenCalled()
  })

  it('defers password-change notifications when Better Auth provides a background helper', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'smtp'
    process.env.NUXT_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.NUXT_SMTP_HOST = 'smtp.example.com'
    vi.mocked(sendEmailMessage).mockResolvedValue(undefined)

    const plugin = librooSecurityNotificationPlugin()
    const beforeHandler = plugin.hooks?.before?.[0]?.handler as (ctx: unknown) => Promise<unknown>
    const afterHandler = plugin.hooks?.after?.[0]?.handler as (ctx: unknown) => Promise<unknown>
    const runInBackgroundOrAwait = vi.fn()
    const ctx = {
      path: '/admin/set-user-password',
      body: { userId: 'user-1' },
      context: {
        returned: { status: true },
        runInBackgroundOrAwait,
        internalAdapter: {
          findUserById: async () => ({
            id: 'user-1',
            name: 'Ada',
            email: 'ada@example.com'
          })
        }
      }
    }

    await beforeHandler(ctx)
    await afterHandler(ctx)

    expect(runInBackgroundOrAwait).toHaveBeenCalledWith(expect.any(Promise))
    await expect(runInBackgroundOrAwait.mock.calls[0]![0]).resolves.toBe(true)
    expect(sendEmailMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ada@example.com'
    }))
  })

  it('awaits password-change notifications inline when no background helper is present', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'smtp'
    process.env.NUXT_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.NUXT_SMTP_HOST = 'smtp.example.com'
    let resolveEmail!: () => void
    const emailPromise = new Promise<void>((resolve) => {
      resolveEmail = resolve
    })
    vi.mocked(sendEmailMessage).mockReturnValue(emailPromise)

    const plugin = librooSecurityNotificationPlugin()
    const beforeHandler = plugin.hooks?.before?.[0]?.handler as (ctx: unknown) => Promise<unknown>
    const afterHandler = plugin.hooks?.after?.[0]?.handler as (ctx: unknown) => Promise<unknown>
    const ctx = {
      path: '/admin/set-user-password',
      body: { userId: 'user-1' },
      context: {
        returned: { status: true },
        internalAdapter: {
          findUserById: async () => ({
            id: 'user-1',
            name: 'Ada',
            email: 'ada@example.com'
          })
        }
      }
    }
    let settled = false

    await beforeHandler(ctx)
    const afterPromise = afterHandler(ctx).then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    resolveEmail()
    await afterPromise
    expect(settled).toBe(true)
  })

  it('logs rejected deferred notification work with operation metadata', async () => {
    process.env.NUXT_EMAIL_PROVIDER = 'smtp'
    process.env.NUXT_EMAIL_FROM = 'Libroo <no-reply@example.com>'
    process.env.NUXT_SMTP_HOST = 'smtp.example.com'
    const error = new Error('smtp failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(sendEmailMessage).mockRejectedValue(error)

    const plugin = librooSecurityNotificationPlugin()
    const beforeHandler = plugin.hooks?.before?.[0]?.handler as (ctx: unknown) => Promise<unknown>
    const afterHandler = plugin.hooks?.after?.[0]?.handler as (ctx: unknown) => Promise<unknown>
    const runInBackgroundOrAwait = vi.fn()
    const ctx = {
      path: '/admin/set-user-password',
      body: { userId: 'user-1' },
      context: {
        returned: { status: true },
        runInBackgroundOrAwait,
        internalAdapter: {
          findUserById: async () => ({
            id: 'user-1',
            name: 'Ada',
            email: 'ada@example.com'
          })
        }
      }
    }

    await beforeHandler(ctx)
    await afterHandler(ctx)
    await expect(runInBackgroundOrAwait.mock.calls[0]![0]).resolves.toBe(false)

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to send password change security notification',
      expect.objectContaining({
        severity: 'error',
        operation: 'security-notification.password-changed',
        path: '/admin/set-user-password',
        error
      })
    )
    consoleError.mockRestore()
  })
})
