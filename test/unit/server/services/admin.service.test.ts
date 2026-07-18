import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminRepository } from '../../../../server/repositories/admin.repository'
import { AuditRepository } from '../../../../server/repositories/audit.repository'
import { DatabaseError } from '../../../../server/repositories/book.repository'
import { AdminForbiddenError, AdminService, AdminServiceLive, InvalidAdminRequestError } from '../../../../server/services/admin.service'

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
    const listLastSessionActivityByUserIds = vi.fn()
    authMock.listUsers.mockRejectedValueOnce({ statusCode: 403 })

    const result = await runAdminService(
      Effect.either(Effect.flatMap(AdminService, service =>
        service.listUsers({ headers: new Headers(), page: 1, pageSize: 25 })
      )),
      listLastSessionActivityByUserIds
    )

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(AdminForbiddenError)
    expect(listLastSessionActivityByUserIds).not.toHaveBeenCalled()
  })

  it('maps Better Auth server failures as server-side errors', async () => {
    const listLastSessionActivityByUserIds = vi.fn()
    authMock.listUsers.mockRejectedValueOnce({ statusCode: 500, message: 'upstream unavailable' })

    const result = await runAdminService(
      Effect.either(Effect.flatMap(AdminService, service =>
        service.listUsers({ headers: new Headers(), page: 1, pageSize: 25 })
      )),
      listLastSessionActivityByUserIds
    )

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(DatabaseError)
    expect(result.left).toMatchObject({
      operation: 'admin.listUsers',
      message: 'upstream unavailable'
    })
    expect(listLastSessionActivityByUserIds).not.toHaveBeenCalled()
  })

  it('loads one Better Auth page and enriches it with last session update dates', async () => {
    const lastSessionActivity = new Date('2026-06-04T12:00:00.000Z')
    const listLastSessionActivityByUserIds = vi.fn(() => Effect.succeed({ 'user-1': lastSessionActivity, 'user-2': null }))

    authMock.listUsers.mockResolvedValueOnce({
      users: [
        {
          id: 'user-1',
          name: 'Ada',
          email: 'ada@example.com',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
          role: 'admin',
          banned: false,
          password: 'secret',
          passwordHash: 'hash',
          hash: 'legacy-hash',
          token: 'session-token'
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

    const result = await runAdminService(
      Effect.flatMap(AdminService, service =>
        service.listUsers({ headers: new Headers(), page: 2, pageSize: 250 })
      ),
      listLastSessionActivityByUserIds
    )

    expect(result).toMatchObject({
      total: 2,
      page: 2,
      pageSize: 100,
      users: [
        {
          id: 'user-1',
          role: 'admin',
          isAdmin: true,
          status: 'active',
          lastSessionActivityAt: lastSessionActivity
        },
        {
          id: 'user-2',
          role: 'user',
          isAdmin: false,
          status: 'banned',
          banReason: 'test',
          lastSessionActivityAt: null
        }
      ]
    })
    expect(new Set(Object.keys(result.users[0]))).toEqual(new Set([
      'id',
      'name',
      'email',
      'createdAt',
      'updatedAt',
      'lastSessionActivityAt',
      'role',
      'isAdmin',
      'status',
      'banReason',
      'banExpires'
    ]))
    expect(result.users[0]).not.toHaveProperty('password')
    expect(result.users[0]).not.toHaveProperty('passwordHash')
    expect(result.users[0]).not.toHaveProperty('hash')
    expect(result.users[0]).not.toHaveProperty('token')
    expect(authMock.listUsers).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      query: {
        limit: 100,
        offset: 100,
        sortBy: 'createdAt',
        sortDirection: 'desc'
      }
    })
    expect(listLastSessionActivityByUserIds).toHaveBeenCalledWith(['user-1', 'user-2'])
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

  it('rejects invalid audit category filters', async () => {
    const listAudit = vi.fn()

    const result = await runAdminService(
      Effect.either(Effect.flatMap(AdminService, service =>
        service.listAuditEntries({
          actor: { id: 'admin-1', role: 'admin' },
          category: 'everything'
        })
      )),
      vi.fn(),
      vi.fn(),
      listAudit
    )

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(InvalidAdminRequestError)
    expect(listAudit).not.toHaveBeenCalled()
  })
})

function runAdminService<A, E>(
  effect: Effect.Effect<A, E, AdminService>,
  listLastSessionActivityByUserIds: ReturnType<typeof vi.fn>,
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
      listLastSessionActivityByUserIds
    })),
    Effect.provide(Layer.succeed(AuditRepository, {
      create: createAudit,
      list: listAudit,
      deleteOlderThan: vi.fn(() => Effect.succeed(0))
    }))
  ))
}
