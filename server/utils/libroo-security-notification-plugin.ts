import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'
import { emailDeliveryConfigured } from './email-verification-config'
import { sendEmailMessage } from '../services/email.service'

type SecurityNotificationUser = {
  id: string
  name?: string | null
  email?: string | null
}

type HookContext = {
  path?: string
  context: {
    returned?: unknown
  }
}

const PASSWORD_CHANGE_USER_KEY = Symbol('libroo-password-change-user')

export const librooSecurityNotificationPlugin = (): BetterAuthPlugin => ({
  id: 'libroo-security-notifications',
  hooks: {
    before: [
      {
        matcher: context => context.path === '/change-password',
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx as Parameters<typeof getSessionFromCtx>[0]).catch(() => null)
          if (!session?.user?.email) return
          setPasswordChangeUser(ctx.context, {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email
          })
        })
      }
    ],
    after: [
      {
        matcher: context => context.path === '/change-password',
        handler: createAuthMiddleware(async (ctx) => {
          await notifyPasswordChanged(ctx as HookContext)
        })
      }
    ]
  }
})

export async function notifyPasswordChanged(ctx: HookContext) {
  if (ctx.path !== '/change-password') return false
  if (!emailDeliveryConfigured()) return false
  if (!await endpointSucceeded(ctx.context.returned)) return false

  return sendPasswordChangedNotification(getPasswordChangeUser(ctx.context))
}

export async function sendPasswordChangedNotification(user: SecurityNotificationUser | null) {
  if (!user?.email) return false

  try {
    await sendPasswordChangedEmail(user)
    return true
  } catch (error) {
    console.error('Failed to send password change security notification', error)
    return false
  }
}

async function sendPasswordChangedEmail(user: SecurityNotificationUser) {
  const displayName = escapeHtml(user.name || user.email || 'there')
  await sendEmailMessage({
    to: user.email!,
    subject: 'Your Libroo password was changed',
    text: [
      `Hello ${user.name || user.email || 'there'},`,
      '',
      'The password for your Libroo account was changed.',
      '',
      'If you made this change, no action is needed. If you did not make this change, contact your Libroo administrator immediately.'
    ].join('\n'),
    html: [
      `<p>Hello ${displayName},</p>`,
      '<p>The password for your Libroo account was changed.</p>',
      '<p>If you made this change, no action is needed. If you did not make this change, contact your Libroo administrator immediately.</p>'
    ].join('')
  })
}

async function endpointSucceeded(returned: unknown) {
  if (!returned) return false
  if (returned instanceof Response) return returned.ok
  if (typeof returned === 'object' && returned && 'statusCode' in returned) return false
  return true
}

function setPasswordChangeUser(context: object, user: SecurityNotificationUser) {
  Object.assign(context, {
    [PASSWORD_CHANGE_USER_KEY]: user
  })
}

function getPasswordChangeUser(context: object): SecurityNotificationUser | null {
  return (context as { [PASSWORD_CHANGE_USER_KEY]?: SecurityNotificationUser })[PASSWORD_CHANGE_USER_KEY] ?? null
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}
