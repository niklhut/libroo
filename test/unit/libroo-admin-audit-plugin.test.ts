import { describe, expect, it } from 'vitest'
import { buildAdminAuditSnapshotsForActor, buildAuthAuditEntry, metadataFromResponse } from '../../server/utils/libroo-admin-audit-plugin'

describe('librooAdminAuditPlugin', () => {
  it('builds role-change audit snapshots from Better Auth admin set-role requests', async () => {
    const snapshots = await buildAdminAuditSnapshotsForActor({
      actorUserId: 'admin-1',
      path: '/admin/set-role',
      body: {
        userId: 'user-1',
        role: 'admin'
      },
      findUserById: async () => ({
        id: 'user-1',
        role: 'user'
      })
    })

    expect(snapshots).toEqual([{
      actorUserId: 'admin-1',
      targetUserId: 'user-1',
      action: 'user.role_changed',
      previous: {
        id: 'user-1',
        role: 'user'
      },
      metadata: {
        previousRole: 'user',
        requestedRole: 'admin'
      }
    }])
    expect(metadataFromResponse(snapshots[0]!, { id: 'user-1', role: 'admin' })).toEqual({
      newRole: 'admin'
    })
  })

  it('builds ban audit snapshots with requested ban metadata', async () => {
    const snapshots = await buildAdminAuditSnapshotsForActor({
      actorUserId: 'admin-1',
      path: '/admin/ban-user',
      body: {
        userId: 'user-1',
        banReason: 'policy',
        banExpiresIn: 3600
      },
      findUserById: async () => ({
        id: 'user-1',
        role: 'user',
        banned: false
      })
    })

    expect(snapshots).toEqual([expect.objectContaining({
      actorUserId: 'admin-1',
      targetUserId: 'user-1',
      action: 'user.banned',
      metadata: {
        previousBanned: false,
        previousBanReason: null,
        banReason: 'policy',
        banExpiresIn: 3600
      }
    })])
    expect(metadataFromResponse(snapshots[0]!, {
      id: 'user-1',
      banned: true,
      banReason: 'policy',
      banExpires: new Date('2026-01-01T00:00:00.000Z')
    })).toEqual({
      newBanned: true,
      banReason: 'policy',
      banExpires: new Date('2026-01-01T00:00:00.000Z')
    })
  })

  it('builds unban audit snapshots from Better Auth admin unban requests', async () => {
    const snapshots = await buildAdminAuditSnapshotsForActor({
      actorUserId: 'admin-1',
      path: '/admin/unban-user',
      body: {
        userId: 'user-1'
      },
      findUserById: async () => ({
        id: 'user-1',
        role: 'user',
        banned: true,
        banReason: 'policy'
      })
    })

    expect(snapshots).toEqual([expect.objectContaining({
      actorUserId: 'admin-1',
      targetUserId: 'user-1',
      action: 'user.unbanned',
      metadata: {
        previousBanned: true,
        previousBanReason: 'policy',
        banReason: null,
        banExpiresIn: null
      }
    })])
    expect(metadataFromResponse(snapshots[0]!, { id: 'user-1', banned: false })).toEqual({
      newBanned: false
    })
  })

  it('normalizes Better Auth update-user role and unban changes', async () => {
    const snapshots = await buildAdminAuditSnapshotsForActor({
      actorUserId: 'admin-1',
      path: '/admin/update-user',
      body: {
        userId: 'user-1',
        data: {
          role: 'admin',
          banned: false
        }
      },
      findUserById: async () => ({
        id: 'user-1',
        role: 'user',
        banned: true,
        banReason: 'policy'
      })
    })

    expect(snapshots.map(snapshot => snapshot.action)).toEqual(['user.role_changed', 'user.unbanned'])
  })

  it('records auth signup entries from successful signup responses', async () => {
    const entry = await buildAuthAuditEntry({
      path: '/sign-up/email',
      body: {
        email: 'new@example.com',
        name: 'New User'
      },
      context: {
        returned: {
          user: {
            id: 'user-1',
            email: 'new@example.com',
            name: 'New User'
          }
        },
        internalAdapter: {
          findUserById: async () => null
        }
      }
    })

    expect(entry).toEqual({
      category: 'auth',
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      action: 'auth.sign_up',
      metadata: {
        email: 'new@example.com',
        name: 'New User'
      }
    })
  })

  it('skips successful sign-in entries but records failed sign-ins', async () => {
    const successfulEntry = await buildAuthAuditEntry({
      path: '/sign-in/email',
      body: {
        email: 'person@example.com'
      },
      context: {
        returned: {
          user: {
            id: 'user-1'
          }
        },
        internalAdapter: {
          findUserById: async () => null
        }
      }
    })

    const failedEntry = await buildAuthAuditEntry({
      path: '/sign-in/email',
      body: {
        email: 'person@example.com'
      },
      context: {
        returned: new Response(JSON.stringify({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password'
        }), {
          status: 401,
          headers: {
            'content-type': 'application/json'
          }
        }),
        internalAdapter: {
          findUserById: async () => null,
          findUserByEmail: async () => ({
            id: 'user-1',
            email: 'person@example.com'
          })
        }
      }
    })

    expect(successfulEntry).toBeNull()
    expect(failedEntry).toEqual({
      category: 'auth',
      actorUserId: null,
      targetUserId: 'user-1',
      action: 'auth.sign_in_failed',
      metadata: {
        email: 'person@example.com',
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password'
      }
    })
  })

  it('records password changes without storing passwords', async () => {
    const entry = await buildAuthAuditEntry({
      path: '/change-password',
      body: {
        currentPassword: 'old-password',
        newPassword: 'new-password',
        revokeOtherSessions: true
      },
      context: {
        returned: {
          status: true
        },
        internalAdapter: {
          findUserById: async () => null
        }
      }
    })

    expect(entry).toEqual({
      category: 'auth',
      actorUserId: null,
      targetUserId: null,
      action: 'auth.password_changed',
      metadata: {
        revokeOtherSessions: true
      }
    })
  })

  it('records immediate account deletion without referencing the deleted user', async () => {
    const entry = await buildAuthAuditEntry({
      path: '/delete-user',
      context: {
        returned: {
          message: 'User deleted'
        },
        internalAdapter: {
          findUserById: async () => null
        }
      }
    })

    expect(entry).toEqual({
      category: 'auth',
      actorUserId: null,
      targetUserId: null,
      action: 'auth.account_deleted',
      metadata: null
    })
  })
})
