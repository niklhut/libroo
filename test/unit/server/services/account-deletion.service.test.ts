import { Effect, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_DELETION_CONFIRMATION_TEXT } from '../../../../shared/utils/account-settings'
import { AccountDeletionRepository } from '../../../../server/repositories/account-deletion.repository'
import { AccountDeletionService, AccountDeletionServiceLive, InvalidAccountDeletionConfirmationError } from '../../../../server/services/account-deletion.service'
import { UnauthorizedError } from '../../../../server/services/auth.service'
import { StorageError, StorageService } from '../../../../server/services/storage.service'

const authMock = vi.hoisted(() => ({
  verifyPassword: vi.fn()
}))

vi.mock('../../../../server/utils/auth', () => ({
  auth: {
    api: {
      verifyPassword: authMock.verifyPassword
    }
  }
}))

describe('AccountDeletionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.verifyPassword.mockResolvedValue({ status: true })
  })

  it('requires the destructive confirmation text before verifying password', async () => {
    const deleteAccountData = vi.fn()
    const deleteBlob = vi.fn()

    const result = await runAccountDeletionService(
      Effect.either(Effect.flatMap(AccountDeletionService, service =>
        service.deleteOwnAccount(makeEvent(), 'user-1', {
          currentPassword: 'secret',
          confirmation: 'delete'
        })
      )),
      deleteAccountData,
      deleteBlob
    )

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(InvalidAccountDeletionConfirmationError)
    expect(authMock.verifyPassword).not.toHaveBeenCalled()
    expect(deleteAccountData).not.toHaveBeenCalled()
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('rejects incorrect current passwords without deleting data', async () => {
    const deleteAccountData = vi.fn()
    const deleteBlob = vi.fn()
    authMock.verifyPassword.mockRejectedValueOnce(new Error('bad password'))

    const result = await runAccountDeletionService(
      Effect.either(Effect.flatMap(AccountDeletionService, service =>
        service.deleteOwnAccount(makeEvent(), 'user-1', {
          currentPassword: 'wrong',
          confirmation: ACCOUNT_DELETION_CONFIRMATION_TEXT
        })
      )),
      deleteAccountData,
      deleteBlob
    )

    expect(result._tag).toBe('Left')
    expect(result.left).toBeInstanceOf(UnauthorizedError)
    expect(deleteAccountData).not.toHaveBeenCalled()
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it('deletes account data and user-specific blobs after password verification', async () => {
    const deleteAccountData = vi.fn(() => Effect.succeed({
      deletedUserId: 'user-1',
      blobPaths: ['covers/manual/user-1/a.webp', 'profiles/user-1.webp'],
      deletedManualBooks: 1,
      deletedUserBooks: 2,
      deletedOwnedLoans: 1,
      anonymizedBorrowedLoans: 1
    }))
    const deleteBlob = vi.fn(() => Effect.void)

    await expect(runAccountDeletionService(
      Effect.flatMap(AccountDeletionService, service =>
        service.deleteOwnAccount(makeEvent(), 'user-1', {
          currentPassword: 'secret',
          confirmation: ACCOUNT_DELETION_CONFIRMATION_TEXT
        })
      ),
      deleteAccountData,
      deleteBlob
    )).resolves.toMatchObject({
      deletedUserId: 'user-1',
      deletedManualBooks: 1,
      deletedUserBooks: 2
    })

    expect(authMock.verifyPassword).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { password: 'secret' }
    })
    expect(deleteAccountData).toHaveBeenCalledWith('user-1')
    expect(deleteBlob).toHaveBeenCalledWith('covers/manual/user-1/a.webp')
    expect(deleteBlob).toHaveBeenCalledWith('profiles/user-1.webp')
  })

  it('still succeeds when post-deletion blob cleanup fails', async () => {
    const deleteAccountData = vi.fn(() => Effect.succeed({
      deletedUserId: 'user-1',
      blobPaths: ['covers/manual/user-1/a.webp'],
      deletedManualBooks: 1,
      deletedUserBooks: 2,
      deletedOwnedLoans: 1,
      anonymizedBorrowedLoans: 1
    }))
    const deleteBlob = vi.fn(() => Effect.fail(new StorageError({
      message: 'blob store unavailable',
      operation: 'delete'
    })))

    await expect(runAccountDeletionService(
      Effect.flatMap(AccountDeletionService, service =>
        service.deleteOwnAccount(makeEvent(), 'user-1', {
          currentPassword: 'secret',
          confirmation: ACCOUNT_DELETION_CONFIRMATION_TEXT
        })
      ),
      deleteAccountData,
      deleteBlob
    )).resolves.toMatchObject({
      deletedUserId: 'user-1',
      deletedManualBooks: 1,
      deletedUserBooks: 2
    })

    expect(deleteAccountData).toHaveBeenCalledWith('user-1')
    expect(deleteBlob).toHaveBeenCalledWith('covers/manual/user-1/a.webp')
  })
})

function runAccountDeletionService<A, E>(
  effect: Effect.Effect<A, E, AccountDeletionService | AccountDeletionRepository | StorageService>,
  deleteAccountData: ReturnType<typeof vi.fn>,
  deleteBlob: ReturnType<typeof vi.fn>
) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(AccountDeletionServiceLive),
    Effect.provide(Layer.succeed(AccountDeletionRepository, {
      deleteAccountData
    })),
    Effect.provide(Layer.succeed(StorageService, {
      put: vi.fn(),
      putCoverImage: vi.fn(),
      get: vi.fn(),
      delete: deleteBlob,
      list: vi.fn()
    }))
  ))
}

function makeEvent() {
  return {
    headers: new Headers()
  } as never
}
