import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsAcceptanceMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'
import { Effect, Layer } from 'effect'
import * as HttpClient from '@effect/platform/HttpClient'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bookSystemTags, books, tags, user, userBooks } from '../../../../server/db/schema'
import { BookRepository, BookRepositoryLive } from '../../../../server/repositories/book.repository'
import { OpenLibraryRepository, type OpenLibraryRepositoryInterface } from '../../../../server/repositories/openLibrary.repository'
import { DbService } from '../../../../server/services/db.service'
import { StorageService, type StorageServiceInterface } from '../../../../server/services/storage.service'

describe('BookRepository cover repair helpers', () => {
  let db: ReturnType<typeof drizzle>
  let client: ReturnType<typeof createClient> | null = null

  beforeEach(async () => {
    client = createClient({ url: ':memory:' })
    db = drizzle(client)
    await client.execute('PRAGMA foreign_keys = ON')

    for (const migration of [initialMigration, termsAcceptanceMigration]) {
      for (const statement of migration.split('--> statement-breakpoint')) {
        const sql = statement.trim()
        if (sql) {
          await client.execute(sql)
        }
      }
    }
  })

  afterEach(async () => {
    client?.close()
    client = null
  })

  it('lists only Open Library books with ISBNs and missing covers', async () => {
    const now = new Date('2026-06-22T10:00:00.000Z')
    await db.insert(books).values([
      { id: 'missing', isbn: '9781234567890', title: 'Missing Cover', source: 'open_library', coverPath: null, createdAt: now },
      { id: 'covered', isbn: '9781234567891', title: 'Covered', source: 'open_library', coverPath: 'covers/9781234567891.webp', createdAt: now },
      { id: 'manual', isbn: '9781234567892', title: 'Manual', source: 'manual', coverPath: null, createdAt: now },
      { id: 'no-isbn', isbn: null, title: 'No ISBN', source: 'open_library', coverPath: null, createdAt: now }
    ])

    const result = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.listOpenLibraryBooksMissingCovers(10)
    ))

    expect(result).toEqual([{ id: 'missing', isbn: '9781234567890' }])
  })

  it('updates missing Open Library covers without overwriting existing cover paths', async () => {
    const now = new Date('2026-06-22T10:00:00.000Z')
    await db.insert(books).values([
      { id: 'missing', isbn: '9781234567890', title: 'Missing Cover', source: 'open_library', coverPath: null, createdAt: now },
      { id: 'covered', isbn: '9781234567891', title: 'Covered', source: 'open_library', coverPath: 'covers/existing.webp', createdAt: now }
    ])

    const firstUpdate = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.updateOpenLibraryCoverPath('missing', 'covers/repaired.webp')
    ))
    const secondUpdate = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.updateOpenLibraryCoverPath('covered', 'covers/overwrite.webp')
    ))

    expect(firstUpdate).toBe(true)
    expect(secondUpdate).toBe(false)

    const rows = await db.select({
      id: books.id,
      coverPath: books.coverPath
    }).from(books)

    expect(rows).toEqual(expect.arrayContaining([
      { id: 'missing', coverPath: 'covers/repaired.webp' },
      { id: 'covered', coverPath: 'covers/existing.webp' }
    ]))
  })

  it('adds an existing Open Library book and hydrates missing system tags', async () => {
    const now = new Date('2026-06-22T10:00:00.000Z')
    const lookupByISBN = vi.fn(() => Effect.succeed({
      title: 'Cached Book',
      authors: ['Ada Author'],
      isbn: '9781234567890',
      openLibraryKey: '/books/OL1M',
      workKey: '/works/OL1W',
      coverUrl: null,
      subjects: ['Programming', 'Computer science']
    }))

    await db.insert(user).values({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      role: 'admin',
      createdAt: now,
      updatedAt: now
    })
    await db.insert(books).values({
      id: 'book-1',
      isbn: '9781234567890',
      title: 'Cached Book',
      source: 'open_library',
      coverPath: null,
      createdAt: now
    })

    const result = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.addBookByISBN('user-1', '9781234567890')
    ), { lookupByISBN })

    expect(result.bookId).toBe('book-1')
    expect(result.book.title).toBe('Cached Book')
    expect(lookupByISBN).toHaveBeenCalledOnce()

    const rows = await db.select({
      userId: userBooks.userId,
      bookId: userBooks.bookId,
      removedAt: userBooks.removedAt
    }).from(userBooks)

    expect(rows).toEqual([{
      userId: 'user-1',
      bookId: 'book-1',
      removedAt: null
    }])

    const systemTagRows = await db.select({
      bookId: bookSystemTags.bookId,
      tagName: tags.name
    })
      .from(bookSystemTags)
      .innerJoin(tags, eq(bookSystemTags.tagId, tags.id))

    expect(systemTagRows).toEqual(expect.arrayContaining([
      { bookId: 'book-1', tagName: 'Programming' },
      { bookId: 'book-1', tagName: 'Computer Science' }
    ]))
  })

  it('falls back to downloading covers when a preview cover path is not in storage', async () => {
    const now = new Date('2026-06-22T10:00:00.000Z')
    const lookupByISBN = vi.fn(() => Effect.succeed({
      title: 'Fresh Book',
      authors: ['Ada Author'],
      isbn: '9781234567890',
      openLibraryKey: '/books/OL1M',
      workKey: '/works/OL1W',
      coverUrl: 'https://covers.openlibrary.org/b/isbn/9781234567890-L.jpg?default=false',
      subjects: []
    }))
    const downloadCover = vi.fn(() => Effect.succeed('covers/downloaded.webp'))
    const get = vi.fn(() => Effect.succeed(null))

    await db.insert(user).values({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      role: 'admin',
      createdAt: now,
      updatedAt: now
    })

    const result = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.addBookByISBN('user-1', '9781234567890', {
        previewCoverPath: 'covers/9781234567890.webp'
      })
    ), { lookupByISBN, downloadCover }, { get })

    expect(result.book.coverPath).toBe('covers/downloaded.webp')
    expect(get).toHaveBeenCalledWith('covers/9781234567890.webp')
    expect(downloadCover).toHaveBeenCalledWith('9781234567890', 'L')

    const rows = await db.select({
      isbn: books.isbn,
      coverPath: books.coverPath
    }).from(books)

    expect(rows).toEqual([{
      isbn: '9781234567890',
      coverPath: 'covers/downloaded.webp'
    }])
  })

  it('uses a verified preview cover path without downloading it again', async () => {
    const now = new Date('2026-06-22T10:00:00.000Z')
    const previewCoverPath = 'covers/9781234567890.jpg'
    const lookupByISBN = vi.fn(() => Effect.succeed({
      title: 'Fresh Book',
      authors: ['Ada Author'],
      isbn: '9781234567890',
      openLibraryKey: '/books/OL1M',
      workKey: '/works/OL1W',
      coverUrl: 'https://covers.openlibrary.org/b/isbn/9781234567890-L.jpg?default=false',
      subjects: []
    }))
    const downloadCover = vi.fn(() => Effect.succeed('covers/downloaded.webp'))
    const get = vi.fn(() => Effect.succeed(new Blob(['stored-cover'], { type: 'image/jpeg' })))

    await db.insert(user).values({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      role: 'admin',
      createdAt: now,
      updatedAt: now
    })

    const result = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.addBookByISBN('user-1', '9781234567890', {
        previewCoverPath
      })
    ), { lookupByISBN, downloadCover }, { get })

    expect(result.book.coverPath).toBe(previewCoverPath)
    expect(get).toHaveBeenCalledWith(previewCoverPath)
    expect(downloadCover).not.toHaveBeenCalled()

    const rows = await db.select({
      isbn: books.isbn,
      coverPath: books.coverPath
    }).from(books)

    expect(rows).toEqual([{
      isbn: '9781234567890',
      coverPath: previewCoverPath
    }])
  })

  it('does not call Open Library when an existing book already has system tags', async () => {
    const now = new Date('2026-06-22T10:00:00.000Z')
    const lookupByISBN = vi.fn(() => Effect.die('Open Library should not be called when tags exist'))

    await db.insert(user).values({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      emailVerified: true,
      role: 'admin',
      createdAt: now,
      updatedAt: now
    })
    await db.insert(books).values({
      id: 'book-1',
      isbn: '9781234567890',
      title: 'Cached Book',
      source: 'open_library',
      coverPath: null,
      createdAt: now
    })
    await db.insert(tags).values({
      id: 'tag-1',
      name: 'Programming',
      normalizedName: 'programming',
      createdAt: now,
      updatedAt: now
    })
    await db.insert(bookSystemTags).values({
      bookId: 'book-1',
      tagId: 'tag-1',
      createdAt: now,
      updatedAt: now
    })

    const result = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.addBookByISBN('user-1', '9781234567890')
    ), { lookupByISBN })

    expect(result.bookId).toBe('book-1')
    expect(lookupByISBN).not.toHaveBeenCalled()
  })
})

function runRepository<A, E>(
  db: ReturnType<typeof drizzle>,
  effect: Effect.Effect<A, E, BookRepository | DbService | StorageService | OpenLibraryRepository | HttpClient.HttpClient>,
  openLibraryOverrides: Partial<OpenLibraryRepositoryInterface> = {},
  storageOverrides: Partial<StorageServiceInterface> = {}
) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(BookRepositoryLive),
    Effect.provide(Layer.succeed(OpenLibraryRepository, {
      lookupByISBN: () => Effect.die('Open Library lookup was not expected'),
      downloadCover: () => Effect.succeed(null),
      ...openLibraryOverrides
    })),
    Effect.provide(Layer.succeed(StorageService, {
      put: () => Effect.die('Storage was not expected'),
      putCoverImage: () => Effect.die('Storage was not expected'),
      get: () => Effect.die('Storage was not expected'),
      delete: () => Effect.die('Storage was not expected'),
      list: () => Effect.die('Storage was not expected'),
      ...storageOverrides
    })),
    Effect.provide(Layer.succeed(HttpClient.HttpClient, {} as never)),
    Effect.provide(Layer.succeed(DbService, { db: db as never }))
  ))
}
