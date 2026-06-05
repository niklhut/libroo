import { describe, expect, it } from 'vitest'
import { bootstrapFirstUserRole, enforceSetRolePolicy } from '../../server/utils/libroo-admin-auth-plugin'

describe('librooAdminPolicyPlugin', () => {
  it('allows promotions to pass through to Better Auth', async () => {
    await expect(enforceSetRolePolicy({
      body: { userId: 'user-2', role: 'admin' },
      actorUserId: 'admin-1',
      findUserById: async () => ({ id: 'user-2', role: 'user' }),
      countAdmins: async () => 1
    })).resolves.toBeUndefined()
  })

  it('blocks admins from demoting themselves on the real Better Auth set-role endpoint', async () => {
    await expect(enforceSetRolePolicy({
      body: { userId: 'admin-1', role: 'user' },
      actorUserId: 'admin-1',
      findUserById: async () => ({ id: 'admin-1', role: 'admin' }),
      countAdmins: async () => 2
    })).rejects.toMatchObject({
      statusCode: 400,
      body: {
        code: 'SELF_ADMIN_DEMOTION'
      }
    })
  })

  it('blocks demoting the last remaining admin on the real Better Auth set-role endpoint', async () => {
    await expect(enforceSetRolePolicy({
      body: { userId: 'admin-1', role: 'user' },
      actorUserId: 'admin-2',
      findUserById: async () => ({ id: 'admin-1', role: 'admin' }),
      countAdmins: async () => 1
    })).rejects.toMatchObject({
      statusCode: 409,
      body: {
        code: 'LAST_ADMIN_DEMOTION'
      }
    })
  })

  it('assigns admin role to the first created user', async () => {
    await expect(bootstrapFirstUserRole(async () => 0)).resolves.toBe('admin')
  })

  it('leaves later created users on Better Auth defaults', async () => {
    await expect(bootstrapFirstUserRole(async () => 1)).resolves.toBeUndefined()
  })
})
