import { describe, expect, it } from 'vitest'
import { assignFirstAdminRole, enforceBanUserPolicy, enforceSetRolePolicy, normalizeAdminBanMutationBody, normalizeAdminRoleMutationBody, roleIncludesAdmin } from '../../server/utils/libroo-admin-auth-plugin'

describe('librooAdminPolicyPlugin', () => {
  it('allows promotions to pass through to Better Auth', async () => {
    await expect(enforceSetRolePolicy({
      body: { userId: 'user-2', role: 'admin' },
      actorUserId: 'admin-1',
      findUserById: async () => ({ id: 'user-2', role: 'user' }),
      countAdmins: async () => 1
    })).resolves.toBeUndefined()
  })

  it('allows comma-separated role updates that keep admin access', async () => {
    const findUserById = async () => ({ id: 'admin-1', role: 'admin' })

    await expect(enforceSetRolePolicy({
      body: { userId: 'admin-1', role: 'user,admin' },
      actorUserId: 'admin-1',
      findUserById,
      countAdmins: async () => 1
    })).resolves.toBeUndefined()
  })

  it('does not treat admin substrings as admin roles', () => {
    expect(roleIncludesAdmin('notadmin')).toBe(false)
    expect(roleIncludesAdmin('superadmin')).toBe(false)
    expect(roleIncludesAdmin('user, admin')).toBe(true)
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

  it('blocks banning the last remaining unbanned admin', async () => {
    await expect(enforceBanUserPolicy({
      body: { userId: 'admin-1' },
      findUserById: async () => ({ id: 'admin-1', role: 'admin', banned: false }),
      countAdmins: async () => 1
    })).rejects.toMatchObject({
      statusCode: 409,
      body: {
        code: 'LAST_ADMIN_BAN'
      }
    })
  })

  it('allows banning an admin when another unbanned admin remains', async () => {
    await expect(enforceBanUserPolicy({
      body: { userId: 'admin-1' },
      findUserById: async () => ({ id: 'admin-1', role: 'admin', banned: false }),
      countAdmins: async () => 2
    })).resolves.toBeUndefined()
  })

  it('normalizes Better Auth ban mutations into policy input', async () => {
    expect(normalizeAdminBanMutationBody('/admin/ban-user', {
      userId: 'admin-1',
      banReason: 'test'
    })).toEqual({
      userId: 'admin-1'
    })
  })

  it('normalizes Better Auth update-user ban changes into policy input', async () => {
    expect(normalizeAdminBanMutationBody('/admin/update-user', {
      userId: 'admin-1',
      data: { banned: true }
    })).toEqual({
      userId: 'admin-1'
    })
  })

  it('normalizes Better Auth update-user role changes into the same policy input', async () => {
    expect(normalizeAdminRoleMutationBody('/admin/update-user', {
      userId: 'admin-1',
      data: { role: 'user' }
    })).toEqual({
      userId: 'admin-1',
      role: 'user'
    })
  })

  it('ignores Better Auth update-user changes that do not touch roles', async () => {
    expect(normalizeAdminRoleMutationBody('/admin/update-user', {
      userId: 'admin-1',
      data: { name: 'Ada' }
    })).toBeUndefined()
  })

  it('reports when the first-admin atomic assignment wins', async () => {
    await expect(assignFirstAdminRole('user-1', async () => ({ changes: 1 }))).resolves.toBe(true)
  })

  it('reports when another user already claimed first-admin assignment', async () => {
    await expect(assignFirstAdminRole('user-2', async () => ({ changes: 0 }))).resolves.toBe(false)
  })

  it('skips first-admin assignment when Better Auth does not return a user id', async () => {
    await expect(assignFirstAdminRole(undefined, async () => ({ changes: 1 }))).resolves.toBe(false)
  })
})
