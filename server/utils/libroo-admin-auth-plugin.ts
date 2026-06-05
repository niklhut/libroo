import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'
import { sql } from 'drizzle-orm'
import { db } from '@nuxthub/db'
import { user } from '@nuxthub/db/schema'

type UserWithRole = {
  id: string
  role?: string | null
}

type SetRoleBody = {
  userId?: string
  role?: string | string[]
}

type UpdateUserBody = {
  userId?: string
  data?: {
    role?: string | string[]
  }
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
        matcher: context => context.path === '/admin/set-role' || context.path === '/admin/update-user',
        handler: createAuthMiddleware(async (ctx) => {
          const body = normalizeAdminRoleMutationBody(ctx.path, ctx.body)
          if (!body) return

          const session = await getSessionFromCtx(ctx)
          if (!session?.user) {
            throw APIError.from('UNAUTHORIZED', { message: 'Unauthorized', code: 'UNAUTHORIZED' })
          }

          await enforceSetRolePolicy({
            body,
            actorUserId: session.user.id,
            findUserById: userId => ctx.context.internalAdapter.findUserById(userId) as Promise<UserWithRole | null>,
            countAdmins: countAdminUsersInDatabase
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
  if (!targetUser || !isEffectiveAdmin(targetUser)) return

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

async function countAdminUsersInDatabase() {
  const rows = await db
    .select({ count: sql<number | string | bigint>`count(*)` })
    .from(user)
    .where(adminRoleTokenPredicate())

  return Number(rows[0]?.count ?? 0)
}

function adminRoleTokenPredicate() {
  return sql`(',' || replace(${user.role}, ' ', '') || ',') LIKE ${'%,admin,%'}`
}

function getAffectedRowCount(result: RunResult | undefined) {
  return result?.changes ?? result?.rowsAffected ?? result?.rowCount ?? 0
}
