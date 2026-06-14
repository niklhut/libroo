import { createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'
import type { AdminAuditAction } from '~~/shared/types/admin-audit'
import type { CreateAdminAuditEntryInput } from '../repositories/audit.repository'
import { createAdminAuditEntryInDatabase } from '../repositories/audit.repository'
import { normalizeAdminBanMutationBody, normalizeAdminRoleMutationBody, roleIncludesAdmin } from './libroo-admin-auth-plugin'

export type UserWithAuditFields = {
  id: string
  name?: string | null
  email?: string | null
  twoFactorEnabled?: boolean | null
  role?: string | null
  banned?: boolean | null
  banReason?: string | null
  banExpires?: string | Date | null
}

export type AuditSnapshot = {
  actorUserId: string
  targetUserId: string
  action: AdminAuditAction
  previous?: UserWithAuditFields | null
  metadata: Record<string, unknown>
}

type AuthActorSnapshot = {
  id: string
  name?: string | null
  email?: string | null
}

type HookContext = {
  path?: string
  body?: unknown
  context: {
    returned?: unknown
    internalAdapter: {
      findUserById: (userId: string) => Promise<UserWithAuditFields | null>
      findUserByEmail?: (email: string) => Promise<UserWithAuditFields | { user?: UserWithAuditFields | null } | null>
    }
  }
}

const SNAPSHOTS_KEY = Symbol('libroo-admin-audit-snapshots')
const AUTH_ACTOR_KEY = Symbol('libroo-auth-audit-actor')

export const librooAdminAuditPlugin = (): BetterAuthPlugin => ({
  id: 'libroo-admin-audit',
  hooks: {
    before: [
      {
        matcher: context => isAuditedAdminMutationPath(context.path),
        handler: createAuthMiddleware(async (ctx) => {
          const snapshots = await buildAdminAuditSnapshots(ctx as HookContext)
          if (snapshots.length > 0) {
            setAuditSnapshots(ctx.context, snapshots)
          }
        })
      },
      {
        matcher: context => isAuditedAuthPath(context.path),
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx as Parameters<typeof getSessionFromCtx>[0]).catch(() => null)
          if (session?.user?.id) {
            setAuthActor(ctx.context, {
              id: session.user.id,
              name: session.user.name,
              email: session.user.email
            })
          }
        })
      }
    ],
    after: [
      {
        matcher: context => isAuditedAdminMutationPath(context.path) || isAuditedAuthPath(context.path),
        handler: createAuthMiddleware(async (ctx) => {
          if (isAuditedAuthPath(ctx.path)) {
            const entry = await buildAuthAuditEntry(ctx as HookContext)
            if (entry) {
              await createAdminAuditEntryInDatabase(entry)
            }
            return
          }

          const snapshots = getAuditSnapshots(ctx.context)
          if (snapshots.length === 0) return
          const response = await getEndpointResponse(ctx.context.returned)
          if (!response) return

          const responseUser = getResponseUser(response)
          for (const snapshot of snapshots) {
            await createAdminAuditEntryInDatabase({
              category: 'admin',
              actorUserId: snapshot.actorUserId,
              targetUserId: snapshot.targetUserId,
              action: snapshot.action,
              metadata: {
                ...snapshot.metadata,
                ...metadataFromResponse(snapshot, responseUser)
              }
            })
          }
        })
      }
    ]
  }
})

export async function buildAdminAuditSnapshots(ctx: HookContext): Promise<AuditSnapshot[]> {
  const session = await getSessionFromCtx(ctx as Parameters<typeof getSessionFromCtx>[0])
  const actorUserId = session?.user?.id
  if (!actorUserId) return []

  return buildAdminAuditSnapshotsForActor({
    actorUserId,
    path: ctx.path,
    body: ctx.body,
    findUserById: userId => ctx.context.internalAdapter.findUserById(userId)
  })
}

export async function buildAdminAuditSnapshotsForActor(input: {
  actorUserId: string
  path?: string
  body?: unknown
  findUserById: (userId: string) => Promise<UserWithAuditFields | null>
}): Promise<AuditSnapshot[]> {
  const roleBody = normalizeAdminRoleMutationBody(input.path, input.body)
  const banBody = normalizeAdminBanMutationBody(input.path, input.body)
  const snapshots: AuditSnapshot[] = []

  if (roleBody?.userId) {
    const previous = await input.findUserById(roleBody.userId)
    snapshots.push({
      actorUserId: input.actorUserId,
      targetUserId: roleBody.userId,
      action: 'user.role_changed',
      previous,
      metadata: {
        previousRole: normalizeRole(previous?.role),
        requestedRole: normalizeRole(roleBody.role)
      }
    })
  }

  if (banBody?.userId) {
    const previous = await input.findUserById(banBody.userId)
    const isUnban = input.path === '/admin/unban-user' || banBody.banned === false
    snapshots.push({
      actorUserId: input.actorUserId,
      targetUserId: banBody.userId,
      action: isUnban ? 'user.unbanned' : 'user.banned',
      previous,
      metadata: {
        previousBanned: Boolean(previous?.banned),
        previousBanReason: previous?.banReason ?? null,
        banReason: banBody.banReason ?? null,
        banExpiresIn: banBody.banExpiresIn ?? null
      }
    })
  }

  return snapshots
}

export function metadataFromResponse(snapshot: AuditSnapshot, responseUser: UserWithAuditFields | null) {
  if (snapshot.action === 'user.role_changed') {
    return {
      newRole: normalizeRole(responseUser?.role)
    }
  }

  if (snapshot.action === 'user.banned') {
    return {
      newBanned: Boolean(responseUser?.banned),
      banReason: responseUser?.banReason ?? snapshot.metadata.banReason ?? null,
      banExpires: responseUser?.banExpires ?? null
    }
  }

  return {
    newBanned: Boolean(responseUser?.banned)
  }
}

export async function buildAuthAuditEntry(ctx: HookContext): Promise<CreateAdminAuditEntryInput | null> {
  const path = ctx.path
  if (!isAuditedAuthPath(path)) return null

  const response = await getEndpointResponse(ctx.context.returned)
  const failure = await getEndpointFailure(ctx.context.returned)
  const session = await getSessionFromCtx(ctx as Parameters<typeof getSessionFromCtx>[0]).catch(() => null)
  const authActor = getAuthActor(ctx.context)
  const actorUserId = authActor?.id ?? session?.user?.id ?? getResponseUser(response)?.id ?? null
  const targetUserId = actorUserId

  if (path === '/sign-in/email') {
    if (!failure) return null

    const email = readStringField(ctx.body, 'email')
    const target = email ? await findUserByEmail(ctx, email) : null

    return authAuditEntry({
      actorUserId: null,
      targetUserId: target?.id ?? null,
      action: 'auth.sign_in_failed',
      metadata: compactMetadata({
        email,
        statusCode: failure.statusCode,
        code: failure.code,
        message: failure.message
      })
    })
  }

  if (!response) return null

  if (path === '/sign-up/email') {
    const user = getResponseUser(response)
    if (!user?.id) return null

    return authAuditEntry({
      actorUserId: user.id,
      targetUserId: user.id,
      action: 'auth.sign_up',
      metadata: compactMetadata({
        email: user.email ?? readStringField(ctx.body, 'email'),
        name: user.name ?? readStringField(ctx.body, 'name')
      })
    })
  }

  if (path === '/change-password') {
    return authAuditEntry({
      actorUserId,
      targetUserId,
      action: 'auth.password_changed',
      metadata: compactMetadata({
        revokeOtherSessions: readBooleanField(ctx.body, 'revokeOtherSessions')
      })
    })
  }

  if (path === '/request-password-reset') {
    const email = readStringField(ctx.body, 'email')
    const target = email ? await findUserByEmail(ctx, email) : null

    return authAuditEntry({
      actorUserId: null,
      targetUserId: target?.id ?? null,
      action: 'auth.password_reset_requested',
      metadata: compactMetadata({ email })
    })
  }

  if (path === '/reset-password') {
    return authAuditEntry({
      actorUserId: null,
      targetUserId: null,
      action: 'auth.password_reset_completed',
      metadata: null
    })
  }

  if (path === '/change-email') {
    return authAuditEntry({
      actorUserId,
      targetUserId,
      action: 'auth.email_change_requested',
      metadata: compactMetadata({
        newEmail: readStringField(ctx.body, 'newEmail')
      })
    })
  }

  if (path === '/delete-user') {
    const deletionWasRequested = responseMessage(response) === 'Verification email sent'

    return authAuditEntry({
      actorUserId: deletionWasRequested ? actorUserId : null,
      targetUserId: deletionWasRequested ? targetUserId : null,
      action: deletionWasRequested ? 'auth.account_deletion_requested' : 'auth.account_deleted',
      metadata: compactMetadata({
        email: authActor?.email,
        name: authActor?.name
      })
    })
  }

  if (path === '/revoke-session') {
    return authAuditEntry({
      actorUserId,
      targetUserId,
      action: 'auth.session_revoked',
      metadata: null
    })
  }

  if (path === '/revoke-sessions' || path === '/revoke-other-sessions') {
    return authAuditEntry({
      actorUserId,
      targetUserId,
      action: 'auth.sessions_revoked',
      metadata: {
        scope: path === '/revoke-other-sessions' ? 'other' : 'all'
      }
    })
  }

  if (path === '/two-factor/disable') {
    return authAuditEntry({
      actorUserId,
      targetUserId,
      action: 'auth.two_factor_disabled',
      metadata: null
    })
  }

  if (path === '/two-factor/generate-backup-codes') {
    return authAuditEntry({
      actorUserId,
      targetUserId,
      action: 'auth.backup_codes_regenerated',
      metadata: null
    })
  }

  if (path === '/two-factor/verify-backup-code') {
    const user = getResponseUser(response)

    return authAuditEntry({
      actorUserId: user?.id ?? actorUserId,
      targetUserId: user?.id ?? targetUserId,
      action: 'auth.backup_code_used',
      metadata: null
    })
  }

  if (path === '/two-factor/verify-totp') {
    const user = getResponseUser(response)
    if (user?.id && user.twoFactorEnabled !== true) return null

    return authAuditEntry({
      actorUserId: user?.id ?? actorUserId,
      targetUserId: user?.id ?? targetUserId,
      action: 'auth.two_factor_enabled',
      metadata: null
    })
  }

  return null
}

function isAuditedAdminMutationPath(path: string | undefined) {
  return path === '/admin/set-role'
    || path === '/admin/update-user'
    || path === '/admin/ban-user'
    || path === '/admin/unban-user'
}

function isAuditedAuthPath(path: string | undefined) {
  return path === '/sign-up/email'
    || path === '/sign-in/email'
    || path === '/change-password'
    || path === '/request-password-reset'
    || path === '/reset-password'
    || path === '/change-email'
    || path === '/delete-user'
    || path === '/revoke-session'
    || path === '/revoke-sessions'
    || path === '/revoke-other-sessions'
    || path === '/two-factor/disable'
    || path === '/two-factor/generate-backup-codes'
    || path === '/two-factor/verify-backup-code'
    || path === '/two-factor/verify-totp'
}

function normalizeRole(role: string | string[] | null | undefined) {
  return roleIncludesAdmin(role) ? 'admin' : 'user'
}

function setAuditSnapshots(context: object, snapshots: AuditSnapshot[]) {
  Object.assign(context, {
    [SNAPSHOTS_KEY]: snapshots
  })
}

function getAuditSnapshots(context: object): AuditSnapshot[] {
  const value = (context as { [SNAPSHOTS_KEY]?: AuditSnapshot[] })[SNAPSHOTS_KEY]
  return Array.isArray(value) ? value : []
}

function setAuthActor(context: object, actor: AuthActorSnapshot) {
  Object.assign(context, {
    [AUTH_ACTOR_KEY]: actor
  })
}

function getAuthActor(context: object): AuthActorSnapshot | null {
  return (context as { [AUTH_ACTOR_KEY]?: AuthActorSnapshot })[AUTH_ACTOR_KEY] ?? null
}

async function getEndpointResponse(returned: unknown) {
  if (!returned) return null
  if (returned instanceof Response) {
    if (!returned.ok) return null
    return await returned.clone().json()
  }
  if (typeof returned === 'object' && returned && 'statusCode' in returned) return null
  return returned
}

function getResponseUser(response: unknown): UserWithAuditFields | null {
  if (!response || typeof response !== 'object') return null
  if ('user' in response && response.user && typeof response.user === 'object') {
    return response.user as UserWithAuditFields
  }
  if ('id' in response) return response as UserWithAuditFields
  return null
}

async function getEndpointFailure(returned: unknown) {
  if (!returned) return null

  if (returned instanceof Response) {
    if (returned.ok) return null
    const body = await returned.clone().json().catch(() => null)
    const bodyRecord = body && typeof body === 'object' ? body as Record<string, unknown> : {}

    return {
      statusCode: returned.status,
      code: readStringField(bodyRecord, 'code'),
      message: readStringField(bodyRecord, 'message')
    }
  }

  if (typeof returned === 'object' && returned && 'statusCode' in returned) {
    const returnedRecord = returned as Record<string, unknown>
    const body = returnedRecord.body
    const bodyRecord = body && typeof body === 'object' ? body as Record<string, unknown> : {}

    return {
      statusCode: Number(returnedRecord.statusCode),
      code: readStringField(returnedRecord, 'code') ?? readStringField(bodyRecord, 'code'),
      message: readStringField(returnedRecord, 'message') ?? readStringField(bodyRecord, 'message')
    }
  }

  return null
}

function authAuditEntry(input: Omit<CreateAdminAuditEntryInput, 'category'>): CreateAdminAuditEntryInput {
  return {
    category: 'auth',
    ...input
  }
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> | null {
  const entries = Object.entries(metadata).filter(([, value]) => value !== null && value !== undefined && value !== '')
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

function responseMessage(response: unknown) {
  return response && typeof response === 'object'
    ? readStringField(response, 'message')
    : null
}

function readStringField(source: unknown, key: string) {
  if (!source || typeof source !== 'object') return null
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readBooleanField(source: unknown, key: string) {
  if (!source || typeof source !== 'object') return null
  const value = (source as Record<string, unknown>)[key]
  return typeof value === 'boolean' ? value : null
}

async function findUserByEmail(ctx: HookContext, email: string) {
  const finder = ctx.context.internalAdapter.findUserByEmail
  if (!finder) return null

  const result = await finder(email).catch(() => null)
  if (!result || typeof result !== 'object') return null
  if ('id' in result && typeof result.id === 'string') return result
  if ('user' in result) return result.user ?? null
  return null
}
