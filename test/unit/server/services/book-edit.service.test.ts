import { Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { BookEditService, BookEditServiceLive } from '../../../../server/services/book-edit.service'
import { BookEditRepository } from '../../../../server/repositories/book-edit.repository'
import { BookNotFoundError, BookRepository } from '../../../../server/repositories/book.repository'
import { OpenLibraryRepository } from '../../../../server/repositories/openLibrary.repository'
import { StorageService } from '../../../../server/services/storage.service'
import { bookEditSchema } from '../../../../shared/utils/schemas'
import type { BookDetails } from '../../../../shared/types/book'

function setup() {
  const current = { id: 'entry', bookId: 'old-book', title: 'Original', coverPath: 'old.webp' } as BookDetails
  const books = { getUserBookWithDetails: vi.fn(() => Effect.succeed(current)) }
  const edits = { isCoverReferenced: vi.fn(() => Effect.succeed(false)), replace: vi.fn(() => Effect.succeed(true)) }
  const storage = { putCoverImage: vi.fn(() => Effect.succeed({ pathname: 'new.webp' })), delete: vi.fn(() => Effect.void) }
  const provider = { fetchCoverImage: vi.fn(() => Effect.succeed(null as ArrayBuffer | null)) }
  const run = <A>(operation: (service: BookEditService['Service']) => Effect.Effect<A, unknown, unknown>) => Effect.runPromise(Effect.flatMap(BookEditService, operation).pipe(
    Effect.provide(BookEditServiceLive),
    Effect.provide(Layer.succeed(BookEditRepository, edits)),
    Effect.provide(Layer.succeed(BookRepository, books as never)),
    Effect.provide(Layer.succeed(OpenLibraryRepository, provider as never)),
    Effect.provide(Layer.succeed(StorageService, storage as never))
  ) as Effect.Effect<A, unknown>)
  const input = bookEditSchema.parse({ expectedBookId: 'old-book', title: 'New title', authors: [' Author '], isbn: '0-441-17271-7' })
  return { current, books, edits, storage, provider, run, input }
}

describe('book editing', () => {
  it('normalizes ISBN and preserves the current cover by default', async () => {
    const { run, input, edits, storage } = setup()
    await run(service => service.save('owner', 'entry', input))
    expect(edits.replace).toHaveBeenCalledWith('owner', 'entry', expect.objectContaining({ title: 'New title', authors: ['Author'], isbn: '9780441172719' }), 'old.webp')
    expect(storage.putCoverImage).not.toHaveBeenCalled()
  })
  it('removes a cover without deleting a potentially shared original blob', async () => {
    const { run, input, edits, storage } = setup()
    await run(service => service.save('owner', 'entry', { ...input, removeCover: true }))
    expect(edits.replace.mock.calls[0]?.[3]).toBeNull()
    expect(storage.delete).not.toHaveBeenCalled()
  })
  it('checks ownership before uploading or changing data', async () => {
    const { run, input, books, edits, storage } = setup()
    books.getUserBookWithDetails.mockImplementation(() => Effect.fail(new BookNotFoundError({ bookId: 'entry' })) as never)
    await expect(run(service => service.save('other', 'entry', input))).rejects.toThrow()
    expect(edits.replace).not.toHaveBeenCalled()
    expect(storage.putCoverImage).not.toHaveBeenCalled()
  })
  it('rejects stale edits before uploading a cover', async () => {
    const { run, input, edits, storage } = setup()
    await expect(run(service => service.save('owner', 'entry', { ...input, expectedBookId: 'stale' }))).rejects.toThrow('This book changed')
    expect(edits.replace).not.toHaveBeenCalled()
    expect(storage.putCoverImage).not.toHaveBeenCalled()
  })
  it('converts uploaded covers through storage and removes an uncommitted upload on conflict', async () => {
    const { run, input, edits, storage } = setup()
    edits.replace.mockImplementation(() => Effect.succeed(false))
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(run(service => service.save('owner', 'entry', { ...input, coverImage: { data: png.toString('base64'), size: png.length, contentType: 'image/png' } }))).rejects.toThrow('This book changed')
    expect(storage.putCoverImage).toHaveBeenCalledWith(expect.stringMatching(/^covers\/manual\/owner\/.+\.webp$/), png)
    expect(storage.delete).toHaveBeenCalledWith('new.webp')
  })
  it.each([false, true])('only deletes a replaced private cover when it has no remaining references (%s)', async (referenced) => {
    const { run, current, input, edits, storage } = setup()
    current.coverPath = 'covers/manual/owner/old.webp'
    edits.isCoverReferenced.mockImplementation(() => Effect.succeed(referenced))
    await run(service => service.save('owner', 'entry', { ...input, removeCover: true }))
    expect(storage.delete.mock.calls.length).toBe(referenced ? 0 : 1)
  })
  it('does not silently invalidate existing reading progress with a smaller page count', async () => {
    const { run, current, input, edits } = setup()
    current.readingProgress = { status: 'reading', currentPage: 50, progressPercent: null, startedAt: null, finishedAt: null }
    await expect(run(service => service.save('owner', 'entry', { ...input, numberOfPages: 20 }))).rejects.toThrow('Page count must be at least your current page')
    expect(edits.replace).not.toHaveBeenCalled()
  })

  it('previews a cover without writing a blob or changing the book', async () => {
    const { run, provider, edits, storage } = setup()
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer
    provider.fetchCoverImage.mockImplementation(() => Effect.succeed(bytes))
    expect(await run(service => service.previewCover('owner', 'entry', '0-441-17271-7'))).toMatchObject({ contentType: 'image/png', size: 8 })
    expect(provider.fetchCoverImage).toHaveBeenCalledWith('9780441172719', 'L')
    expect(storage.putCoverImage).not.toHaveBeenCalled()
    expect(edits.replace).not.toHaveBeenCalled()
  })
  it('does not fetch a cover for another user’s book', async () => {
    const { run, provider, books } = setup()
    books.getUserBookWithDetails.mockImplementation(() => Effect.fail(new BookNotFoundError({ bookId: 'entry' })) as never)
    await expect(run(service => service.previewCover('other', 'entry', '9780441172719'))).rejects.toThrow()
    expect(provider.fetchCoverImage).not.toHaveBeenCalled()
  })
  it('reports unavailable covers without changing anything', async () => {
    const { run, storage } = setup()
    await expect(run(service => service.previewCover('owner', 'entry', '9780441172719'))).rejects.toThrow('No cover was found')
    expect(storage.putCoverImage).not.toHaveBeenCalled()
  })
  it('rejects missing titles and conflicting cover choices', () => {
    const { input } = setup()
    expect(bookEditSchema.safeParse({ ...input, title: '' }).success).toBe(false)
    expect(bookEditSchema.safeParse({ ...input, authors: [] }).success).toBe(false)
    expect(bookEditSchema.safeParse({ ...input, removeCover: true, coverImage: { data: 'aGVsbG8=', size: 5, contentType: 'image/png' } }).success).toBe(false)
  })
})
