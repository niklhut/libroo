import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'
import { emailDeliveryConfigured } from './email-verification-config'
import { sendEmailMessage } from '../services/email.service'

type SecurityNotificationUser = {
  id: string
  name?: string | null
  email?: string | null
  twoFactorEnabled?: boolean | null
}

type HookContext = {
  path?: string
  context: {
    returned?: unknown
    runInBackgroundOrAwait?: (promise?: Promise<unknown>) => unknown
    internalAdapter?: {
      findUserById?: (userId: string) => Promise<SecurityNotificationUser | null>
    }
  }
  body?: unknown
}

const SECURITY_CHANGE_USER_KEY = Symbol('libroo-security-change-user')
const PASSWORD_CHANGE_PATHS = new Set(['/change-password', '/admin/set-user-password'])
export const TWO_FACTOR_PATHS = new Set([
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/two-factor/verify-totp'
])
export const PASSKEY_PATHS = new Set([
  '/passkey/verify-registration',
  '/passkey/delete-passkey'
])

export const librooSecurityNotificationPlugin = (): BetterAuthPlugin => ({
  id: 'libroo-security-notifications',
  hooks: {
    before: [{
      matcher: context => isSecurityNotificationPath(context.path),
      handler: createAuthMiddleware(async (ctx) => {
        const user = ctx.path === '/admin/set-user-password'
          ? await getAdminPasswordTargetUser(ctx as HookContext)
          : await getCurrentSessionUser(ctx)
        if (user?.email) setSecurityChangeUser(ctx.context, user)
      })
    }],
    after: [{
      matcher: context => isSecurityNotificationPath(context.path),
      handler: createAuthMiddleware(async (ctx) => {
        await runInBackgroundOrAwait(ctx as HookContext, notifySecurityChange(ctx as HookContext))
      })
    }]
  }
})

function runInBackgroundOrAwait(ctx: HookContext, promise: Promise<unknown>) {
  return ctx.context.runInBackgroundOrAwait
    ? ctx.context.runInBackgroundOrAwait(promise)
    : promise
}

// Kept as a focused export for existing consumers and tests.
export async function notifyPasswordChanged(ctx: HookContext) {
  if (!isPasswordChangePath(ctx.path)) return false
  return notifySecurityChange(ctx)
}

export async function notifySecurityChange(ctx: HookContext) {
  if (!isSecurityNotificationPath(ctx.path)) return false
  if (!emailDeliveryConfigured() || !await endpointSucceeded(ctx.context.returned)) return false

  // verify-totp also completes every TOTP sign-in challenge; only notify for
  // the enrollment transition captured from an authenticated pre-hook session.
  if (ctx.path === '/two-factor/verify-totp' && getSecurityChangeUser(ctx.context)?.twoFactorEnabled !== false) {
    return false
  }

  return sendSecurityChangeNotification(getSecurityChangeUser(ctx.context), ctx.path)
}

async function getCurrentSessionUser(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) {
  const session = await getSessionFromCtx(ctx as Parameters<typeof getSessionFromCtx>[0]).catch(() => null)
  if (!session?.user?.email) return null

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    twoFactorEnabled: session.user.twoFactorEnabled
  }
}

async function getAdminPasswordTargetUser(ctx: HookContext) {
  const userId = getUserIdFromBody(ctx.body)
  return userId ? ctx.context.internalAdapter?.findUserById?.(userId) ?? null : null
}

export async function sendPasswordChangedNotification(user: SecurityNotificationUser | null, path?: string) {
  return sendSecurityChangeNotification(user, path)
}

export async function sendSecurityChangeNotification(user: SecurityNotificationUser | null, path?: string) {
  if (!user?.email) return false

  try {
    await sendSecurityChangeEmail(user, path)
    return true
  } catch (error) {
    console.error(isPasswordChangePath(path)
      ? 'Failed to send password change security notification'
      : 'Failed to send security change notification', {
      severity: 'error',
      operation: isPasswordChangePath(path)
        ? 'security-notification.password-changed'
        : 'security-notification.security-change',
      path,
      error
    })
    return false
  }
}

async function sendSecurityChangeEmail(user: SecurityNotificationUser, path?: string) {
  const change = getSecurityChangeCopy(path)
  const displayName = escapeHtml(user.name || user.email || 'there')
  await sendEmailMessage({
    to: user.email!,
    subject: change.subject,
    text: [
      `Hello ${user.name || user.email || 'there'},`,
      '',
      change.text,
      '',
      'If you made this change, no action is needed. If you did not make this change, contact your Libroo administrator immediately.'
    ].join('\n'),
    html: [
      `<p>Hello ${displayName},</p>`,
      `<p>${escapeHtml(change.text)}</p>`,
      '<p>If you made this change, no action is needed. If you did not make this change, contact your Libroo administrator immediately.</p>'
    ].join('')
  })
}

async function endpointSucceeded(returned: unknown) {
  if (!returned) return false
  if (returned instanceof Response) return returned.ok
  if (typeof returned === 'object') {
    if ('statusCode' in returned) return false
    if ('status' in returned && typeof returned.status === 'boolean') return returned.status
    if ('success' in returned && typeof returned.success === 'boolean') return returned.success
  }
  return false
}

function isPasswordChangePath(path: string | undefined) {
  return Boolean(path && PASSWORD_CHANGE_PATHS.has(path))
}

export function isTwoFactorPath(path: string | undefined) {
  return Boolean(path && TWO_FACTOR_PATHS.has(path))
}

export function isPasskeyPath(path: string | undefined) {
  return Boolean(path && PASSKEY_PATHS.has(path))
}

export function isSecurityNotificationPath(path: string | undefined) {
  return isPasswordChangePath(path) || isTwoFactorPath(path) || isPasskeyPath(path)
}

function getSecurityChangeCopy(path: string | undefined) {
  if (path === '/two-factor/disable') return {
    subject: 'Two-factor authentication was disabled',
    text: 'Two-factor authentication for your Libroo account was disabled.'
  }
  if (path === '/two-factor/generate-backup-codes') return {
    subject: 'Your Libroo recovery codes were regenerated',
    text: 'The recovery codes for your Libroo account were regenerated. All previous recovery codes are no longer valid.'
  }
  if (path === '/two-factor/verify-totp') return {
    subject: 'Two-factor authentication was enabled',
    text: 'Two-factor authentication was enabled for your Libroo account.'
  }
  if (path === '/passkey/verify-registration') return {
    subject: 'A passkey was added to your Libroo account',
    text: 'A passkey was added to your Libroo account.'
  }
  if (path === '/passkey/delete-passkey') return {
    subject: 'A passkey was removed from your Libroo account',
    text: 'A passkey was removed from your Libroo account.'
  }
  return {
    subject: 'Your Libroo password was changed',
    text: 'The password for your Libroo account was changed.'
  }
}

function getUserIdFromBody(body: unknown) {
  const userId = body && typeof body === 'object' ? (body as { userId?: unknown }).userId : null
  return typeof userId === 'string' && userId.trim() ? userId.trim() : null
}

function setSecurityChangeUser(context: object, user: SecurityNotificationUser) {
  Object.assign(context, { [SECURITY_CHANGE_USER_KEY]: user })
}

function getSecurityChangeUser(context: object): SecurityNotificationUser | null {
  return (context as { [SECURITY_CHANGE_USER_KEY]?: SecurityNotificationUser })[SECURITY_CHANGE_USER_KEY] ?? null
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}
