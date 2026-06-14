import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminRepository } from '../../../../server/repositories/admin.repository'
import { AuditRepository } from '../../../../server/repositories/audit.repository'
import { DatabaseError } from '../../../../server/repositories/book.repository'
import { AdminForbiddenError, AdminService, AdminServiceLive } from '../../../../server/services/admin.service'

const authMock = vi.hoisted(() => ({
  listUsers: vi.fn()
}))

vi.mock('../../../../server/utils/auth', () => ({
  auth: {
    api: {
      listUsers: authMock.listUsers
    }
  }
}))

describe('AdminService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps Better Auth authorization failures', async () => {
    const listLastActiveByUserIds = vi.fn()
    authMock.listUsers.mockRejectedValueOnce({ statusCode: 403 })

    const result = await runAdminService(
      Effect.either(Effect.flatMap(AdminService, service =>
        service.listUsers({ headers: new Headers(), page: 1, pageSize: 25 })
      )),
      listLastActiveByUserIds
    )

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(AdminForbiddenError)
    expect(listLastActiveByUserIds).not.toHaveBeenCalled()
  })

  it('maps Better Auth server failures as server-side errors', async () => {
    const listLastActiveByUserIds = vi.fn()
    authMock.listUsers.mockRejectedValueOnce({ statusCode: 500, message: 'upstream unavailable' })

    const result = await runAdminService(
      Effect.either(Effect.flatMap(AdminService, service =>
        service.listUsers({ headers: new Headers(), page: 1, pageSize: 25 })
      )),
      listLastActiveByUserIds
    )

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(DatabaseError)
    expect(result.left).toMatchObject({
      operation: 'admin.listUsers',
      message: 'upstream unavailable'
    })
    expect(listLastActiveByUserIds).not.toHaveBeenCalled()
  })

  it('loads one Better Auth page and enriches it with last active dates', async () => {
    const lastActive = new Date('2026-06-04T12:00:00.000Z')
    const listLastActiveByUserIds = vi.fn(() => Effect.succeed({ 'user-1': lastActive, 'user-2': null }))

    authMock.listUsers.mockResolvedValueOnce({
      users: [
        {
          id: 'user-1',
          name: 'Ada',
          email: 'ada@example.com',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          role: 'admin',
          banned: false
        },
        {
          id: 'user-2',
          name: 'Grace',
          email: 'grace@example.com',
          createdAt: new Date('2026-01-03T00:00:00.000Z'),
          updatedAt: new Date('2026-01-04T00:00:00.000Z'),
          role: 'user',
          banned: true,
          banReason: 'test',
          banExpires: null
        }
      ],
      total: 2
    })

    await expect(runAdminService(
      Effect.flatMap(AdminService, service =>
        service.listUsers({ headers: new Headers(), page: 2, pageSize: 250 })
      ),
      listLastActiveByUserIds
    )).resolves.toMatchObject({
      total: 2,
      page: 2,
      pageSize: 100,
      users: [
        {
          id: 'user-1',
          role: 'admin',
          isAdmin: true,
          status: 'active',
          lastActiveAt: lastActive
        },
        {
          id: 'user-2',
          role: 'user',
          isAdmin: false,
          status: 'banned',
          banReason: 'test',
          lastActiveAt: null
        }
      ]
    })
    expect(authMock.listUsers).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: {
        limit: 100,
        offset: 100,
        sortBy: 'createdAt',
        sortDirection: 'desc'
      }
    })
    expect(listLastActiveByUserIds).toHaveBeenCalledWith(['user-1', 'user-2'])
  })

  it('rejects audit reads for non-admin users', async () => {
    const listAudit = vi.fn()

    const result = await runAdminService(
      Effect.either(Effect.flatMap(AdminService, service =>
        service.listAuditEntries({
          actor: { id: 'user-1', role: 'user' }
        })
      )),
      vi.fn(),
      vi.fn(),
      listAudit
    )

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(AdminForbiddenError)
    expect(listAudit).not.toHaveBeenCalled()
  })
})

function runAdminService<A, E>(
  effect: Effect.Effect<A, E, AdminService>,
  listLastActiveByUserIds: ReturnType<typeof vi.fn>,
  createAudit: ReturnType<typeof vi.fn> = vi.fn(entry => Effect.succeed({
    id: 'audit-1',
    createdAt: new Date(),
    ...entry
  })),
  listAudit: ReturnType<typeof vi.fn> = vi.fn(() => Effect.succeed({ entries: [], total: 0 }))
) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(AdminServiceLive),
    Effect.provide(Layer.succeed(AdminRepository, {
      listLastActiveByUserIds
    })),
    Effect.provide(Layer.succeed(AuditRepository, {
      create: createAudit,
      list: listAudit,
      deleteOlderThan: vi.fn(() => Effect.succeed(0))
    }))
  ))
}
