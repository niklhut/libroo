import { Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { BookRepository, type Book, type BookRepositoryInterface } from '../../../../server/repositories/book.repository'
import { BookEnrichmentRepository } from '../../../../server/repositories/book-enrichment.repository'
import { CanonicalBookEnrichmentRepository } from '../../../../server/repositories/canonical-book-enrichment.repository'
import { LocationRepository } from '../../../../server/repositories/location.repository'
import { OpenLibraryRepository } from '../../../../server/repositories/openLibrary.repository'
import type { OpenLibraryBookData } from '../../../../shared/types/open-library'
import { BookServiceLive, lookupBook } from '../../../../server/services/book.service'

Object.assign(globalThis, { BookRepository, OpenLibraryRepository, LocationRepository })

const isbn = '9780441172719'
const metadata: OpenLibraryBookData = {
  isbn, title: 'Dune', authors: ['Frank Herbert'], openLibraryKey: '/books/OL1M',
  workKey: '/works/OL1W', coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg?default=false'
}
const book: Book = {
  id: 'book-1', isbn, title: metadata.title, author: 'Frank Herbert',
  authors: [{ id: 'author-1', name: 'Frank Herbert' }], source: 'open_library',
  openLibraryKey: metadata.openLibraryKey, coverPath: null, createdAt: new Date(),
  createdByUserId: null, openLibraryMetadata: metadata
}

function setup(overrides: Partial<BookRepositoryInterface> = {}) {
  const repository = {
    hasBookInUserLibrary: vi.fn(() => Effect.succeed(null)),
    findByIsbn: vi.fn(() => Effect.succeed(null)),
    createCoreOpenLibraryBook: vi.fn(() => Effect.succeed(book)),
    getSystemTagsByBookId: vi.fn(() => Effect.succeed([])),
    ...overrides
  }
  const upstream = { lookupCoreByISBN: vi.fn(() => Effect.succeed(metadata)) }
  const jobs = { ensurePending: vi.fn(() => Effect.succeed({ status: 'pending' })) }
  const run = () => Effect.runPromise(lookupBook('user-1', isbn).pipe(
    Effect.provide(BookServiceLive),
    Effect.provide(Layer.succeed(BookRepository, repository as unknown as BookRepositoryInterface)),
    Effect.provide(Layer.succeed(OpenLibraryRepository, upstream as never)),
    Effect.provide(Layer.succeed(CanonicalBookEnrichmentRepository, jobs as never)),
    Effect.provide(Layer.succeed(BookEnrichmentRepository, {} as never)),
    Effect.provide(Layer.succeed(LocationRepository, {} as never))
  ))
  return { repository, upstream, jobs, run }
}

describe('interactive book lookup', () => {
  it('checks the local catalog once and returns a cover preview without waiting for enrichment', async () => {
    const { run, repository, upstream } = setup()
    const result = await run()
    expect(result).toMatchObject({
      found: true, bookId: book.id, coverUrl: metadata.coverUrl,
      enrichment: { status: 'queued' }
    })
    expect(repository.findByIsbn).toHaveBeenCalledTimes(1)
    expect(upstream.lookupCoreByISBN).toHaveBeenCalledTimes(1)
    expect(repository.createCoreOpenLibraryBook).toHaveBeenCalledWith(isbn, metadata)
  })

  it('serves existing canonical books without an upstream metadata request', async () => {
    const { run, upstream, repository } = setup({ findByIsbn: () => Effect.succeed(book) })
    await expect(run()).resolves.toMatchObject({ found: true, title: 'Dune' })
    expect(upstream.lookupCoreByISBN).not.toHaveBeenCalled()
    expect(repository.createCoreOpenLibraryBook).not.toHaveBeenCalled()
  })

  it('starts the canonical read while the ownership read is still pending', async () => {
    let finishOwnership: (() => void) | undefined
    const { run } = setup({
      hasBookInUserLibrary: () => Effect.async((resume) => {
        finishOwnership = () => resume(Effect.succeed(null))
      }),
      findByIsbn: () => Effect.sync(() => {
        expect(finishOwnership).toBeTypeOf('function')
        finishOwnership!()
        return book
      })
    })
    await expect(run()).resolves.toMatchObject({ found: true })
  })
})
