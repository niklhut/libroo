import { Context, Data, Effect, Layer } from 'effect'
import { BookEditRepository } from '../repositories/book-edit.repository'
import { BookRepository } from '../repositories/book.repository'
import { OpenLibraryRepository } from '../repositories/openLibrary.repository'
import { decodeCoverImage, InvalidManualCoverError, InvalidReadingProgressError } from './book.service'
import { deleteBlob, putCoverImage } from './storage.service'
import { detectImageContentType, UNKNOWN_IMAGE_CONTENT_TYPE } from '../../shared/utils/image-content-type'
import { normalizeIsbnIdentity } from '../../shared/utils/isbn'
import type { BookEditSchema } from '../../shared/utils/schemas'

export class BookEditConflictError extends Data.TaggedError('BookEditConflictError')<{ message: string }> {}
export class BookCoverNotFoundError extends Data.TaggedError('BookCoverNotFoundError')<{ message: string }> {}

export const makeBookEditService = Effect.gen(function* () {
  const repository = yield* BookEditRepository
  const books = yield* BookRepository
  const provider = yield* OpenLibraryRepository
  return {
    save: (userId: string, userBookId: string, input: BookEditSchema) => Effect.gen(function* () {
      const current = yield* books.getUserBookWithDetails(userBookId, userId)
      if (current.bookId !== input.expectedBookId) return yield* Effect.fail(new BookEditConflictError({ message: 'This book changed. Close the editor, refresh and try again.' }))
      if (input.numberOfPages && current.readingProgress?.currentPage && input.numberOfPages < current.readingProgress.currentPage) {
        return yield* Effect.fail(new InvalidReadingProgressError({ message: `Page count must be at least your current page (${current.readingProgress.currentPage}). Update reading progress first.` }))
      }
      let uploaded: string | null = null
      let coverPath = input.removeCover ? null : current.coverPath
      if (input.coverImage) {
        const bytes = yield* decodeCoverImage(input.coverImage.data)
        const result = yield* putCoverImage(`covers/manual/${userId}/${crypto.randomUUID()}.webp`, bytes).pipe(
          Effect.mapError(error => error.operation === 'convertCoverImage' ? new InvalidManualCoverError({ message: 'Cover image is invalid or unsupported' }) : error)
        )
        coverPath = uploaded = result.pathname
      }
      yield* Effect.gen(function* () {
        const saved = yield* repository.replace(userId, userBookId, { ...input, isbn: input.isbn ? normalizeIsbnIdentity(input.isbn) : null }, coverPath)
        if (!saved) return yield* Effect.fail(new BookEditConflictError({ message: 'This book changed. Close the editor, refresh and try again.' }))
      }).pipe(Effect.tapError(() => uploaded ? deleteBlob(uploaded).pipe(Effect.catch(() => Effect.void)) : Effect.void))
      if (current.coverPath && current.coverPath !== coverPath && current.coverPath.startsWith(`covers/manual/${userId}/`)) {
        yield* repository.isCoverReferenced(current.coverPath).pipe(
          Effect.flatMap(referenced => referenced ? Effect.void : deleteBlob(current.coverPath!)),
          Effect.catch(error => Effect.logWarning(`Could not clean up replaced cover: ${String(error)}`))
        )
      }
      return yield* books.getUserBookWithDetails(userBookId, userId)
    }),
    previewCover: (userId: string, userBookId: string, isbn: string) => Effect.gen(function* () {
      yield* books.getUserBookWithDetails(userBookId, userId)
      const image = yield* provider.fetchCoverImage(normalizeIsbnIdentity(isbn), 'L')
      if (!image) return yield* Effect.fail(new BookCoverNotFoundError({ message: 'No cover was found for this ISBN. You can upload an image instead.' }))
      const contentType = detectImageContentType(image)
      if (contentType === UNKNOWN_IMAGE_CONTENT_TYPE) return yield* Effect.fail(new InvalidManualCoverError({ message: 'The source did not return a supported cover image.' }))
      return { data: Buffer.from(image).toString('base64'), contentType, size: image.byteLength }
    })
  }
})
export class BookEditService extends Context.Service<BookEditService, Effect.Success<typeof makeBookEditService>>()('BookEditService') {}
export const BookEditServiceLive = Layer.effect(BookEditService, makeBookEditService)
