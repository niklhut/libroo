import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'
import { sql } from 'drizzle-orm'
import { parseRoleValues, roleIncludesAdmin } from '~~/shared/utils/auth-roles'
import { isActiveBan } from '~~/shared/utils/auth-status'
import { newPasswordSchema } from '~~/shared/utils/password'
import { db, user } from '../runtime/auth-db.active'

type UserWithRole = {
  id: string
  role?: string | null
  banned?: boolean | null
  banExpires?: string | Date | null
}

type SetRoleBody = {
  userId?: string
  role?: string | string[]
}

type UpdateUserBody = {
  userId?: string
  data?: {
    role?: string | string[]
    banned?: boolean | null
  }
}

type BanUserBody = {
  userId?: string
  banned?: boolean | null
  banReason?: string | null
  banExpiresIn?: number | null
}

type CreateUser = {
  id?: string
}

type RunResult = {
  changes?: number
  rowsAffected?: number
  rowCount?: number
}

type BanReservationResult
  = | { reserved: true }
    | { reserved: false, reason: 'last_admin' | 'concurrent' }

export const IMPERSONATION_DISABLED_MESSAGE = 'Admin impersonation is disabled for this Libroo beta.'

const isEffectiveAdmin = (user: UserWithRole) =>
  roleIncludesAdmin(user.role)

const nextRoleIncludesAdmin = (role: string | string[] | undefined) =>
  parseRoleValues(role).includes('admin')

export const librooAdminPolicyPlugin = (): BetterAuthPlugin => ({
  id: 'libroo-admin-policy',
  init() {
    return {
      options: {
        databaseHooks: {
          user: {
            create: {
              after: async (createdUser) => {
                await assignFirstAdminRole((createdUser as CreateUser).id)
              }
            }
          }
        }
      }
    }
  },
  hooks: {
    before: [
      {
        matcher: context => context.path === '/admin/set-role'
          || context.path === '/admin/update-user'
          || context.path === '/admin/ban-user',
        handler: createAuthMiddleware(async (ctx) => {
          const session = await getSessionFromCtx(ctx)
          if (!session?.user) {
            throw APIError.from('UNAUTHORIZED', { message: 'Unauthorized', code: 'UNAUTHORIZED' })
          }

          const findUserById = (userId: string) =>
            ctx.context.internalAdapter.findUserById(userId) as Promise<UserWithRole | null>
          const countAdmins = countUnbannedAdminUsersInDatabase

          const body = normalizeAdminRoleMutationBody(ctx.path, ctx.body)
          if (body) {
            await enforceSetRolePolicy({
              body,
              actorUserId: session.user.id,
              findUserById,
              countAdmins
            })
          }

          const banBody = normalizeAdminBanMutationBody(ctx.path, ctx.body)
          if (!banBody || banBody.banned !== true) return

          await enforceBanUserPolicy({
            body: banBody,
            actorUserId: session.user.id,
            findUserById,
            reserveAdminBan: reserveAdminBanInDatabase
          })
        })
      },
      {
        matcher: context => context.path === '/admin/impersonate-user'
          || context.path === '/admin/stop-impersonating',
        handler: createAuthMiddleware(() => {
          blockAdminImpersonation()
        })
      },
      {
        matcher: context => context.path === '/admin/set-user-password',
        handler: createAuthMiddleware(async (ctx) => {
          validateAdminSetUserPasswordBody(ctx.body)
        })
      }
    ]
  }
})

export function blockAdminImpersonation(): never {
  throw APIError.from('FORBIDDEN', {
    message: IMPERSONATION_DISABLED_MESSAGE,
    code: 'IMPERSONATION_DISABLED'
  })
}

export function validateAdminSetUserPasswordBody(bodyValue: unknown) {
  const body = isRecord(bodyValue) ? bodyValue : {}
  const result = newPasswordSchema('New password is required').safeParse(body.newPassword)
  if (result.success) return

  throw APIError.from('BAD_REQUEST', {
    message: result.error.issues[0]?.message ?? 'Password is invalid',
    code: 'INVALID_NEW_PASSWORD'
  })
}

export function normalizeAdminRoleMutationBody(path: string | undefined, body: unknown): SetRoleBody | undefined {
  if (path === '/admin/set-role') {
    return body as SetRoleBody
  }

  if (path === '/admin/update-user') {
    const updateBody = body as UpdateUserBody
    if (!updateBody.data || !('role' in updateBody.data)) return undefined

    return {
      userId: updateBody.userId,
      role: updateBody.data.role
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function normalizeAdminBanMutationBody(path: string | undefined, body: unknown): BanUserBody | undefined {
  if (path === '/admin/ban-user') {
    const bodyValue = body as BanUserBody
    return {
      userId: bodyValue.userId,
      banned: true,
      banReason: bodyValue.banReason,
      banExpiresIn: bodyValue.banExpiresIn
    }
  }

  if (path === '/admin/unban-user') {
    return {
      userId: (body as BanUserBody).userId,
      banned: false
    }
  }

  if (path === '/admin/update-user') {
    const updateBody = body as UpdateUserBody
    if (!updateBody.data || !('banned' in updateBody.data)) return undefined

    return {
      userId: updateBody.userId,
      banned: updateBody.data.banned
    }
  }
}

export async function assignFirstAdminRole(
  userId: string | undefined,
  runAtomicAssignment: (userId: string) => Promise<RunResult | undefined> = assignFirstAdminRoleInDatabase
) {
  if (!userId) return false

  const result = await runAtomicAssignment(userId)
  return getAffectedRowCount(result) > 0
}

export async function enforceSetRolePolicy(input: {
  body: SetRoleBody
  actorUserId: string
  findUserById: (userId: string) => Promise<UserWithRole | null>
  countAdmins: () => Promise<number>
}) {
  if (!input.body.userId || nextRoleIncludesAdmin(input.body.role)) return

  const targetUser = await input.findUserById(input.body.userId)
  if (!targetUser || !isEffectiveAdmin(targetUser) || isActiveBan(targetUser)) return

  if (input.actorUserId === input.body.userId) {
    throw APIError.from('BAD_REQUEST', {
      message: 'You cannot remove admin rights from yourself',
      code: 'SELF_ADMIN_DEMOTION'
    })
  }

  if (await input.countAdmins() <= 1) {
    throw APIError.from('CONFLICT', {
      message: 'Cannot remove admin rights from the last remaining admin',
      code: 'LAST_ADMIN_DEMOTION'
    })
  }
}

export async function enforceBanUserPolicy(input: {
  body: BanUserBody
  actorUserId: string
  findUserById: (userId: string) => Promise<UserWithRole | null>
  reserveAdminBan: (userId: string) => Promise<BanReservationResult>
}) {
  if (!input.body.userId) return

  const targetUser = await input.findUserById(input.body.userId)
  if (!targetUser || !isEffectiveAdmin(targetUser) || isActiveBan(targetUser)) return

  if (input.actorUserId === input.body.userId) {
    throw APIError.from('BAD_REQUEST', {
      message: 'You cannot ban yourself',
      code: 'SELF_ADMIN_BAN'
    })
  }

  const reservation = await input.reserveAdminBan(input.body.userId)
  if (reservation.reserved) return

  if (reservation.reason === 'concurrent') {
    throw APIError.from('CONFLICT', {
      message: 'Account status changed while banning admin',
      code: 'ADMIN_BAN_CONFLICT'
    })
  }

  if (reservation.reason === 'last_admin') {
    throw APIError.from('CONFLICT', {
      message: 'Cannot ban the last remaining unbanned admin',
      code: 'LAST_ADMIN_BAN'
    })
  }
}

async function assignFirstAdminRoleInDatabase(userId: string) {
  return db.run(sql`
    UPDATE ${user}
    SET role = 'admin'
    WHERE ${user.id} = ${userId}
      AND ${user.id} = (
        SELECT ${user.id}
        FROM ${user}
        ORDER BY ${user.createdAt} ASC, ${user.id} ASC
        LIMIT 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM ${user}
        WHERE ${adminRoleTokenPredicate()}
      )
  `)
}

async function reserveAdminBanInDatabase(userId: string): Promise<BanReservationResult> {
  const result = await db.run(sql`
    UPDATE ${user}
    SET banned = true
    WHERE ${user.id} = ${userId}
      AND ${adminRoleTokenPredicate()}
      AND ${inactiveBanPredicate()}
      AND (
        SELECT count(*)
        FROM ${user}
        WHERE ${user.id} <> ${userId}
          AND ${adminRoleTokenPredicate()}
          AND ${inactiveBanPredicate()}
      ) > 0
  `)

  if (getAffectedRowCount(result) > 0) {
    return { reserved: true }
  }

  const targetRows = await db
    .select({
      id: user.id,
      role: user.role,
      banned: user.banned,
      banExpires: user.banExpires
    })
    .from(user)
    .where(sql`${user.id} = ${userId}`)

  const targetUser = targetRows[0]
  if (!targetUser || !isEffectiveAdmin(targetUser) || isActiveBan(targetUser)) {
    return { reserved: false, reason: 'concurrent' }
  }

  return {
    reserved: false,
    reason: await countUnbannedAdminUsersInDatabase() <= 1 ? 'last_admin' : 'concurrent'
  }
}

async function countUnbannedAdminUsersInDatabase() {
  const rows = await db
    .select({ count: sql<number | string | bigint>`count(*)` })
    .from(user)
    .where(sql`${adminRoleTokenPredicate()} AND ${inactiveBanPredicate()}`)

  return Number(rows[0]?.count ?? 0)
}

function adminRoleTokenPredicate() {
  return sql`(',' || replace(${user.role}, ' ', '') || ',') LIKE ${'%,admin,%'}`
}

function inactiveBanPredicate() {
  return sql`(
    COALESCE(${user.banned}, false) = false
    OR (${user.banExpires} IS NOT NULL AND ${user.banExpires} <= ${new Date()})
  )`
}

function getAffectedRowCount(result: RunResult | undefined) {
  return result?.changes ?? result?.rowsAffected ?? result?.rowCount ?? 0
}
