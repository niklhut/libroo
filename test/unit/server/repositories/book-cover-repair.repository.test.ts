import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Effect, Layer } from 'effect'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { books, user, userBooks } from '../../../../server/db/schema'
import { BookRepository, BookRepositoryLive } from '../../../../server/repositories/book.repository'
import { OpenLibraryApiError, OpenLibraryRepository } from '../../../../server/repositories/openLibrary.repository'
import { DbService } from '../../../../server/services/db.service'

describe('BookRepository cover repair helpers', () => {
  let db: ReturnType<typeof drizzle>
  let dbDir: string
  let client: ReturnType<typeof createClient> | null = null

  beforeEach(async () => {
    dbDir = await mkdtemp(join(tmpdir(), 'libroo-book-cover-repair-'))
    client = createClient({ url: `file:${join(dbDir, 'test.db')}` })
    db = drizzle(client)
    await client.execute('PRAGMA foreign_keys = ON')

    const migrationPath = fileURLToPath(
      new URL('../../../../server/db/migrations/sqlite/0000_initial_beta.sql', import.meta.url)
    )
    const migration = await readFile(migrationPath, 'utf8')
    for (const statement of migration.split('--> statement-breakpoint')) {
      const sql = statement.trim()
      if (sql) {
        await client.execute(sql)
      }
    }
  })

  afterEach(async () => {
    client?.close()
    client = null
    await rm(dbDir, { recursive: true, force: true })
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

  it('adds an existing Open Library book even when tag hydration lookup fails', async () => {
    const now = new Date('2026-06-22T10:00:00.000Z')
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
    ))

    expect(result.bookId).toBe('book-1')
    expect(result.book.title).toBe('Cached Book')

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
  })
})

function runRepository<A, E>(db: ReturnType<typeof drizzle>, effect: Effect.Effect<A, E, BookRepository | DbService>) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(BookRepositoryLive),
    Effect.provide(Layer.succeed(OpenLibraryRepository, {
      lookupByISBN: () => Effect.fail(new OpenLibraryApiError({ message: 'timeout' })),
      downloadCover: () => Effect.succeed(null)
    })),
    Effect.provide(Layer.succeed(DbService, { db: db as never }))
  ))
}
