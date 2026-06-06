import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'
import { sql } from 'drizzle-orm'
import { db } from '@nuxthub/db'
import { user } from '@nuxthub/db/schema'

type UserWithRole = {
  id: string
  role?: string | null
  banned?: boolean | null
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
}

type CreateUser = {
  id?: string
}

type RunResult = {
  changes?: number
  rowsAffected?: number
  rowCount?: number
}

const parseRoleValues = (role: string | string[] | null | undefined): string[] => {
  const values = Array.isArray(role) ? role : [role ?? 'user']
  return values.flatMap(value => value.split(',')).map(part => part.trim()).filter(Boolean)
}

export const roleIncludesAdmin = (role: string | string[] | null | undefined) =>
  parseRoleValues(role).includes('admin')

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
          if (!banBody) return

          await enforceBanUserPolicy({
            body: banBody,
            findUserById,
            countAdmins
          })
        })
      }
    ]
  }
})

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

export function normalizeAdminBanMutationBody(path: string | undefined, body: unknown): SetRoleBody | undefined {
  if (path === '/admin/ban-user') {
    return {
      userId: (body as BanUserBody).userId
    }
  }

  if (path === '/admin/update-user') {
    const updateBody = body as UpdateUserBody
    if (!updateBody.data || updateBody.data.banned !== true) return undefined

    return {
      userId: updateBody.userId
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
  if (!targetUser || !isEffectiveAdmin(targetUser) || targetUser.banned) return

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
  findUserById: (userId: string) => Promise<UserWithRole | null>
  countAdmins: () => Promise<number>
}) {
  if (!input.body.userId) return

  const targetUser = await input.findUserById(input.body.userId)
  if (!targetUser || !isEffectiveAdmin(targetUser) || targetUser.banned) return

  if (await input.countAdmins() <= 1) {
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
      AND NOT EXISTS (
        SELECT 1
        FROM ${user}
        WHERE ${user.id} <> ${userId}
          AND ${adminRoleTokenPredicate()}
      )
  `)
}

async function countUnbannedAdminUsersInDatabase() {
  const rows = await db
    .select({ count: sql<number | string | bigint>`count(*)` })
    .from(user)
    .where(sql`${adminRoleTokenPredicate()} AND ${user.banned} = false`)

  return Number(rows[0]?.count ?? 0)
}

function adminRoleTokenPredicate() {
  return sql`(',' || replace(${user.role}, ' ', '') || ',') LIKE ${'%,admin,%'}`
}

function getAffectedRowCount(result: RunResult | undefined) {
  return result?.changes ?? result?.rowsAffected ?? result?.rowCount ?? 0
}
