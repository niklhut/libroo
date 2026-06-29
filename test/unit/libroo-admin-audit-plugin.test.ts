import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAdminAuditSnapshotsForActor, buildAuthAuditEntry, librooAdminAuditPlugin, metadataFromResponse } from '../../server/utils/libroo-admin-audit-plugin'
import { createAdminAuditEntryInDatabase } from '../../server/repositories/audit.repository'

vi.mock('../../server/repositories/audit.repository', () => ({
  createAdminAuditEntryInDatabase: vi.fn()
}))

afterEach(() => {
  vi.clearAllMocks()
})

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

  it('records one email-change confirmation when verification confirms a pending email', async () => {
    const token = makeJwtPayload({
      email: 'old@example.com',
      updateTo: 'new@example.com'
    })
    const ctx = {
      path: '/verify-email',
      body: { token },
      context: {
        returned: {
          status: true
        },
        internalAdapter: {
          findUserById: async () => null,
          findUserByEmail: async () => ({
            id: 'user-1',
            name: 'Changed User',
            email: 'old@example.com',
            pendingEmail: 'new@example.com'
          })
        },
        runInBackgroundOrAwait: vi.fn((promise?: Promise<unknown>) => promise)
      }
    }
    const plugin = librooAdminAuditPlugin()
    const beforeHandler = plugin.hooks?.before?.[1]?.handler as (ctx: unknown) => Promise<unknown>
    const afterHandler = plugin.hooks?.after?.[0]?.handler as (ctx: unknown) => Promise<unknown>

    await beforeHandler(ctx)
    await afterHandler(ctx)

    expect(createAdminAuditEntryInDatabase).toHaveBeenCalledTimes(1)
    expect(createAdminAuditEntryInDatabase).toHaveBeenCalledWith({
      category: 'auth',
      actorUserId: 'user-1',
      targetUserId: 'user-1',
      action: 'auth.email_change_confirmed',
      metadata: {
        newEmail: 'new@example.com'
      }
    })
  })

  it('does not record email-change confirmation for initial signup verification', async () => {
    const token = makeJwtPayload({
      email: 'new@example.com'
    })
    const ctx = {
      path: '/verify-email',
      body: { token },
      context: {
        returned: {
          status: true
        },
        internalAdapter: {
          findUserById: async () => null,
          findUserByEmail: async () => ({
            id: 'user-1',
            name: 'New User',
            email: 'new@example.com',
            pendingEmail: null
          })
        },
        runInBackgroundOrAwait: vi.fn((promise?: Promise<unknown>) => promise)
      }
    }
    const plugin = librooAdminAuditPlugin()
    const beforeHandler = plugin.hooks?.before?.[1]?.handler as (ctx: unknown) => Promise<unknown>
    const afterHandler = plugin.hooks?.after?.[0]?.handler as (ctx: unknown) => Promise<unknown>

    await beforeHandler(ctx)
    await afterHandler(ctx)

    expect(createAdminAuditEntryInDatabase).not.toHaveBeenCalled()
  })

  it('defers post-success audit persistence when Better Auth provides a background helper', async () => {
    let resolvePersist!: () => void
    const persistPromise = new Promise<void>((resolve) => {
      resolvePersist = resolve
    })
    vi.mocked(createAdminAuditEntryInDatabase).mockReturnValue(persistPromise)

    const runInBackgroundOrAwait = vi.fn()
    const ctx = successfulSignupHookContext({ runInBackgroundOrAwait })
    const afterHandler = librooAdminAuditPlugin().hooks?.after?.[0]?.handler as (ctx: unknown) => Promise<unknown>

    await afterHandler(ctx)

    expect(createAdminAuditEntryInDatabase).toHaveBeenCalledWith(expect.objectContaining({
      category: 'auth',
      action: 'auth.sign_up'
    }))
    expect(runInBackgroundOrAwait).toHaveBeenCalledWith(expect.any(Promise))

    resolvePersist()
    await expect(runInBackgroundOrAwait.mock.calls[0]![0]).resolves.toBeUndefined()
  })

  it('awaits post-success audit persistence inline when no background helper is present', async () => {
    let resolvePersist!: () => void
    const persistPromise = new Promise<void>((resolve) => {
      resolvePersist = resolve
    })
    vi.mocked(createAdminAuditEntryInDatabase).mockReturnValue(persistPromise)

    const ctx = successfulSignupHookContext()
    const afterHandler = librooAdminAuditPlugin().hooks?.after?.[0]?.handler as (ctx: unknown) => Promise<unknown>
    let settled = false

    const afterPromise = afterHandler(ctx).then(() => {
      settled = true
    })
    await Promise.resolve()

    expect(settled).toBe(false)
    resolvePersist()
    await afterPromise
    expect(settled).toBe(true)
  })

  it('logs rejected audit persistence with action and path metadata', async () => {
    const error = new Error('database unavailable')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(createAdminAuditEntryInDatabase).mockRejectedValue(error)

    const runInBackgroundOrAwait = vi.fn()
    const ctx = successfulSignupHookContext({ runInBackgroundOrAwait })
    const afterHandler = librooAdminAuditPlugin().hooks?.after?.[0]?.handler as (ctx: unknown) => Promise<unknown>

    await afterHandler(ctx)
    await expect(runInBackgroundOrAwait.mock.calls[0]![0]).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to persist auth audit entry',
      expect.objectContaining({
        severity: 'error',
        operation: 'admin-audit.persist',
        category: 'auth',
        action: 'auth.sign_up',
        path: '/sign-up/email',
        error
      })
    )
    consoleError.mockRestore()
  })
})

function successfulSignupHookContext(options: {
  runInBackgroundOrAwait?: (promise?: Promise<unknown>) => unknown
} = {}) {
  return {
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
      runInBackgroundOrAwait: options.runInBackgroundOrAwait,
      internalAdapter: {
        findUserById: async () => null
      }
    }
  }
}

function makeJwtPayload(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value))
    .toString('base64url')

  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`
}
