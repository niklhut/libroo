import { Effect, Either, Layer } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookRepository, type BookRepositoryInterface } from '../../../../server/repositories/book.repository'
import { LendingRepository, type LendingRepositoryInterface } from '../../../../server/repositories/lending.repository'
import { CoverAccessDeniedError, getAuthorizedCover } from '../../../../server/services/coverAccess.service'
import { StorageService, type StorageServiceInterface } from '../../../../server/services/storage.service'

describe('getAuthorizedCover', () => {
  const user = { id: 'user-1' }
  const blob = new Blob(['cover'], { type: 'image/webp' })
  let bookRepository: Pick<BookRepositoryInterface, 'userOwnsManualCover'>
  let lendingRepository: Pick<LendingRepositoryInterface, 'userHasLoanCoverAccess'>
  let storageService: Pick<StorageServiceInterface, 'get'>

  beforeEach(() => {
    bookRepository = {
      userOwnsManualCover: vi.fn(() => Effect.succeed(false))
    }
    lendingRepository = {
      userHasLoanCoverAccess: vi.fn(() => Effect.succeed(false))
    }
    storageService = {
      get: vi.fn(() => Effect.succeed(blob))
    }
  })

  it('allows manual covers owned by the signed-in user', async () => {
    vi.mocked(bookRepository.userOwnsManualCover).mockReturnValueOnce(Effect.succeed(true))

    await expect(run('covers/manual/user-1/book.webp')).resolves.toBe(blob)
    expect(bookRepository.userOwnsManualCover).toHaveBeenCalledWith('user-1', 'covers/manual/user-1/book.webp')
    expect(lendingRepository.userHasLoanCoverAccess).not.toHaveBeenCalled()
    expect(storageService.get).toHaveBeenCalledWith('covers/manual/user-1/book.webp')
  })

  it('allows manual covers through active accepted borrower loan access', async () => {
    vi.mocked(lendingRepository.userHasLoanCoverAccess).mockReturnValueOnce(Effect.succeed(true))

    await expect(run('covers/manual/owner-1/book.webp')).resolves.toBe(blob)
    expect(bookRepository.userOwnsManualCover).toHaveBeenCalledWith('user-1', 'covers/manual/owner-1/book.webp')
    expect(lendingRepository.userHasLoanCoverAccess).toHaveBeenCalledWith('user-1', 'covers/manual/owner-1/book.webp')
    expect(storageService.get).toHaveBeenCalledWith('covers/manual/owner-1/book.webp')
  })

  it('denies unrelated manual covers without reading storage', async () => {
    const result = await runEither('covers/manual/other/book.webp')

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(CoverAccessDeniedError)
    }
    expect(storageService.get).not.toHaveBeenCalled()
  })

  it('allows trusted ISBN cover paths for any authenticated user', async () => {
    await expect(run('covers/9781234567890.jpg')).resolves.toBe(blob)
    expect(bookRepository.userOwnsManualCover).not.toHaveBeenCalled()
    expect(lendingRepository.userHasLoanCoverAccess).not.toHaveBeenCalled()
    expect(storageService.get).toHaveBeenCalledWith('covers/9781234567890.jpg')
  })

  it('denies unknown path patterns without reading storage', async () => {
    const result = await runEither('avatars/user-1.webp')

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(CoverAccessDeniedError)
    }
    expect(storageService.get).not.toHaveBeenCalled()
  })

  it('denies missing blobs with the same tagged error', async () => {
    vi.mocked(storageService.get).mockReturnValueOnce(Effect.succeed(null))
    const result = await runEither('covers/9781234567890.webp')

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(CoverAccessDeniedError)
    }
  })

  function run(pathname: string) {
    return Effect.runPromise(provide(getAuthorizedCover(pathname, user)))
  }

  function runEither(pathname: string) {
    return Effect.runPromise(Effect.either(provide(getAuthorizedCover(pathname, user))))
  }

  function provide<A, E>(effect: Effect.Effect<A, E, BookRepository | LendingRepository | StorageService>) {
    return effect.pipe(
      Effect.provide(Layer.succeed(BookRepository, bookRepository as BookRepositoryInterface)),
      Effect.provide(Layer.succeed(LendingRepository, lendingRepository as LendingRepositoryInterface)),
      Effect.provide(Layer.succeed(StorageService, storageService as StorageServiceInterface))
    )
  }
})
