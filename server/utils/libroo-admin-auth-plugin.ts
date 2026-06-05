import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import type { BetterAuthPlugin } from 'better-auth/types'

type UserWithRole = {
  id: string
  role?: string | null
}

type UserWhere = {
  field: string
  operator: 'contains' | 'eq'
  value: string
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

const roleIncludesAdmin = (role: string | null | undefined) =>
  (role ?? 'user').split(',').map(part => part.trim()).includes('admin')

const isEffectiveAdmin = (user: UserWithRole) =>
  roleIncludesAdmin(user.role)

const nextRoleIncludesAdmin = (role: string | string[] | undefined) => {
  const roles = Array.isArray(role) ? role : [role]
  return roles.some(value => value === 'admin')
}

export const librooAdminPolicyPlugin = (): BetterAuthPlugin => ({
  id: 'libroo-admin-policy',
  init() {
    return {
      options: {
        databaseHooks: {
          user: {
            create: {
              before: async (_user, ctx) => {
                if (!ctx) return

                const role = await bootstrapFirstUserRole(() => ctx.context.internalAdapter.countTotalUsers())
                if (!role) return

                return {
                  data: { role }
                }
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
            countAdmins: () => ctx.context.internalAdapter.countTotalUsers(adminRoleWhere)
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

export async function bootstrapFirstUserRole(countUsers: () => Promise<number>) {
  return (await countUsers()) === 0 ? 'admin' : undefined
}

const adminRoleWhere: UserWhere[] = [
  { field: 'role', operator: 'contains', value: 'admin' }
]
