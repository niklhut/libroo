import { Data, Effect } from 'effect'
import type { User } from 'better-auth/types'
import { BookRepository, type DatabaseError } from '../repositories/book.repository'
import { LendingRepository } from '../repositories/lending.repository'
import type { DbService } from './db.service'
import type { StorageError } from './storage.service'
import { StorageService } from './storage.service'

export class CoverAccessDeniedError extends Data.TaggedError('CoverAccessDeniedError')<{
  pathname: string
}> { }

const TRUSTED_COVER_EXTENSIONS = new Set(['webp', 'jpg', 'jpeg', 'png', 'gif'])
const manualCoverPrefix = 'covers/manual/'
const isbnCoverPattern = /^covers\/[^/]+\.(?<extension>[^/.]+)$/

export const getAuthorizedCover = (
  pathname: string,
  user: Pick<User, 'id'>
): Effect.Effect<Blob, CoverAccessDeniedError | DatabaseError | StorageError, BookRepository | LendingRepository | StorageService | DbService> =>
  Effect.gen(function* () {
    const authorized = yield* authorizeCoverPath(pathname, user.id)

    if (!authorized) {
      return yield* Effect.fail(new CoverAccessDeniedError({ pathname }))
    }

    const storage = yield* StorageService
    const blob = yield* storage.get(pathname)

    if (!blob) {
      return yield* Effect.fail(new CoverAccessDeniedError({ pathname }))
    }

    return blob
  })

const authorizeCoverPath = (
  pathname: string,
  userId: string
): Effect.Effect<boolean, DatabaseError, BookRepository | LendingRepository | DbService> =>
  Effect.gen(function* () {
    if (pathname.startsWith(manualCoverPrefix) && pathname.length > manualCoverPrefix.length) {
      const bookRepository = yield* BookRepository
      const lendingRepository = yield* LendingRepository
      const ownsCover = yield* bookRepository.userOwnsManualCover(userId, pathname)

      if (ownsCover) {
        return true
      }

      return yield* lendingRepository.userHasLoanCoverAccess(userId, pathname)
    }

    const match = isbnCoverPattern.exec(pathname)
    const extension = match?.groups?.extension?.toLowerCase()
    return Boolean(extension && TRUSTED_COVER_EXTENSIONS.has(extension))
  })
