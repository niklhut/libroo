import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditRepository } from '../../../../server/repositories/audit.repository'
import { AuditService, AuditServiceLive } from '../../../../server/services/audit.service'

describe('AuditService', () => {
  beforeEach(() => {
    auditRepoMock.deleteOlderThan.mockReset()
    auditRepoMock.deleteOlderThan.mockReturnValue(Effect.succeed(0))
  })

  it('deletes auth and admin audit entries using separate retention windows', async () => {
    auditRepoMock.deleteOlderThan
      .mockReturnValueOnce(Effect.succeed(2))
      .mockReturnValueOnce(Effect.succeed(3))

    await expect(runAuditService(
      Effect.flatMap(AuditService, service => service.cleanupExpiredEntries({
        authRetentionDays: 5,
        adminRetentionDays: 30,
        now: new Date('2026-06-14T12:00:00.000Z')
      }))
    )).resolves.toEqual({
      authDeleted: 2,
      adminDeleted: 3,
      authRetentionDays: 5,
      adminRetentionDays: 30
    })

    expect(auditRepoMock.deleteOlderThan).toHaveBeenCalledWith({
      category: 'auth',
      before: new Date('2026-06-09T12:00:00.000Z')
    })
    expect(auditRepoMock.deleteOlderThan).toHaveBeenCalledWith({
      category: 'admin',
      before: new Date('2026-05-15T12:00:00.000Z')
    })
  })

  it('falls back to default retention days for invalid config values', async () => {
    await expect(runAuditService(
      Effect.flatMap(AuditService, service => service.cleanupExpiredEntries({
        authRetentionDays: 'nope',
        adminRetentionDays: Number.MAX_SAFE_INTEGER,
        now: new Date('2026-06-14T12:00:00.000Z')
      }))
    )).resolves.toMatchObject({
      authRetentionDays: 5,
      adminRetentionDays: 30
    })
  })

  it('normalizes fractional retention days before calculating cutoffs', async () => {
    await expect(runAuditService(
      Effect.flatMap(AuditService, service => service.cleanupExpiredEntries({
        authRetentionDays: 5.9,
        adminRetentionDays: '30.9',
        now: new Date('2026-06-14T12:00:00.000Z')
      }))
    )).resolves.toMatchObject({
      authRetentionDays: 5,
      adminRetentionDays: 30
    })
  })
})

const auditRepoMock = {
  create: vi.fn(),
  list: vi.fn(),
  deleteOlderThan: vi.fn()
}

function runAuditService<A, E>(effect: Effect.Effect<A, E, AuditService | AuditRepository>) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(AuditServiceLive),
    Effect.provide(Layer.succeed(AuditRepository, auditRepoMock))
  ))
}
