import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Effect, Layer } from 'effect'

const liveLayerNames = [
  'AuthServiceLive',
  'BookRepositoryLive',
  'OpenLibraryRepositoryLive',
  'LendingRepositoryLive',
  'AdminRepositoryLive',
  'AuditRepositoryLive',
  'LocationRepositoryLive',
  'LibraryTransferRepositoryLive',
  'PreferencesRepositoryLive',
  'AuthRepositoryLive',
  'AccountDeletionRepositoryLive',
  'SignupInviteRepositoryLive',
  'HealthRepositoryLive',
  'LegalRepositoryLive',
  'RateLimitRepositoryLive',
  'BookServiceLive',
  'LendingServiceLive',
  'AdminServiceLive',
  'AuditServiceLive',
  'LocationServiceLive',
  'LibraryTransferServiceLive',
  'PreferencesServiceLive',
  'AccountDeletionServiceLive',
  'SignupInviteServiceLive',
  'AuthRequestServiceLive',
  'EmailCapabilityServiceLive',
  'HealthServiceLive',
  'LegalServiceLive',
  'RateLimitServiceLive'
] as const

vi.mock('../../../../server/runtime/active', () => ({
  RuntimeInfrastructureLive: Layer.empty
}))

vi.mock('../../../../server/repositories/rate-limit.repository', () => ({
  RateLimitRepositoryLive: Layer.empty
}))

vi.mock('../../../../server/services/rate-limit.service', () => ({
  RateLimitServiceLive: Layer.empty
}))

describe('handleError', () => {
  beforeAll(() => {
    for (const name of liveLayerNames) {
      vi.stubGlobal(name, Layer.empty)
    }
    vi.stubGlobal('createError', ({ statusCode, message }: { statusCode: number, message: string }) => {
      return Object.assign(new Error(message), { statusCode })
    })
    vi.stubGlobal('isError', (error: unknown) => {
      return error instanceof Error && 'statusCode' in error
    })
  })

  it('logs tagged error context and preserves HTTP conversion', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { runEffect } = await import('../../../../server/utils/effect')
    const domainError = {
      _tag: 'BookNotFoundError',
      isbn: '9781234567890',
      message: 'missing book',
      operation: 'findByIsbn'
    }

    await expect(runEffect(Effect.fail(domainError))).rejects.toMatchObject({
      statusCode: 404,
      message: 'Book with ISBN 9781234567890 not found'
    })
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({
      tag: 'BookNotFoundError',
      operation: 'findByIsbn',
      level: 'Error'
    }))
  })
})
