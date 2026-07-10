/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:workers'
import { Effect, Either, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'
import locationRestrictMigration from '../../../../server/db/migrations/sqlite/0002_prevent_location_delete_cascade.sql?raw'
import libraryStateMigration from '../../../../server/db/migrations/sqlite/0003_add_library_state.sql?raw'
import previouslyOwnedMigration from '../../../../server/db/migrations/sqlite/0006_huge_tiger_shark.sql?raw'
import libraryIndexesMigration from '../../../../server/db/migrations/sqlite/0004_add_user_books_library_indexes.sql?raw'
import activeUserBookUniqueMigration from '../../../../server/db/migrations/sqlite/0005_add_active_user_book_unique.sql?raw'
import { bookAuthors, books, loans, user, userBooks, userBookTags } from '../../../../server/db/schema'
import { ActiveLoanRemovalError, BookCreateError, BookRepository, BookRepositoryLive } from '../../../../server/repositories/book.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type D1Db = ReturnType<typeof drizzle>

let db: D1Db

describe('BookRepository.createManualBook on D1', () => {
  beforeAll(async () => {
    db = drizzle(env.DB)
    await applyMigrations(env.DB)
  })

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM loans').run()
    await env.DB.prepare('DELETE FROM user_book_tags').run()
    await env.DB.prepare('DELETE FROM book_authors').run()
    await env.DB.prepare('DELETE FROM tags').run()
    await env.DB.prepare('DELETE FROM user_books').run()
    await env.DB.prepare('DELETE FROM books').run()
    await env.DB.prepare('DELETE FROM authors').run()
    await env.DB.prepare('DELETE FROM user').run()
    await seedUser(db)
  })

  it('creates a manual book through D1 batch without opening a transaction', async () => {
    const result = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.createManualBook('user-1', {
        title: 'Manual Cloudflare Book',
        authors: ['Ada Lovelace', 'Ada Lovelace', 'Grace Hopper'],
        isbn: null,
        coverPath: 'covers/manual/user-1/book.webp',
        publishDate: '1843',
        publisher: 'Notes Press',
        numberOfPages: 42,
        rating: 5,
        note: 'Works on D1',
        libraryState: 'owned',
        readingStatus: 'reading',
        currentPage: 12,
        progressPercent: 25,
        tags: ['Computing', 'Computing', 'History']
      })
    ))

    expect(result).toMatchObject({
      id: expect.any(String),
      book: {
        title: 'Manual Cloudflare Book',
        author: 'Ada Lovelace, Grace Hopper'
      }
    })
    expect([...result.tags].sort()).toEqual(['Computing', 'History'])

    await expect(db.select().from(books).where(eq(books.id, result.bookId))).resolves.toHaveLength(1)
    await expect(db.select().from(userBooks).where(eq(userBooks.id, result.id))).resolves.toHaveLength(1)
    await expect(db.select().from(bookAuthors).where(eq(bookAuthors.bookId, result.bookId))).resolves.toHaveLength(2)
    await expect(db.select().from(userBookTags).where(eq(userBookTags.userBookId, result.id))).resolves.toHaveLength(2)
  })

  it('rejects manual cover paths outside the signed-in user namespace', async () => {
    const result = await runRepository(db, Effect.either(Effect.flatMap(BookRepository, repository =>
      repository.createManualBook('user-1', {
        title: 'Borrowed Path',
        authors: ['Ada Lovelace'],
        isbn: null,
        coverPath: 'covers/manual/user-2/book.webp',
        publishDate: null,
        publisher: null,
        numberOfPages: null,
        rating: null,
        note: null,
        libraryState: 'owned',
        readingStatus: 'unread',
        currentPage: null,
        progressPercent: null,
        tags: []
      })
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(BookCreateError)
    }
    await expect(db.select().from(books)).resolves.toHaveLength(0)
    await expect(db.select().from(userBooks)).resolves.toHaveLength(0)
    await expect(db.select().from(bookAuthors)).resolves.toHaveLength(0)
    await expect(db.select().from(userBookTags)).resolves.toHaveLength(0)
  })

  it('inserts sanitized wishlist state, converts state without touching metadata, and filters by state', async () => {
    const created = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.createManualBook('user-1', {
        title: 'Wishlist Book',
        authors: ['Ada Lovelace'],
        isbn: null,
        coverPath: null,
        publishDate: null,
        publisher: null,
        numberOfPages: null,
        rating: 4,
        note: 'keep this',
        libraryState: 'wishlisted',
        readingStatus: 'reading',
        currentPage: 12,
        progressPercent: 25,
        tags: ['Maybe']
      })
    ))

    expect(created.libraryState).toBe('wishlisted')
    const [storedWishlist] = await db
      .select({
        libraryState: userBooks.libraryState,
        rating: userBooks.rating,
        note: userBooks.note,
        readingStatus: userBooks.readingStatus,
        currentPage: userBooks.currentPage,
        progressPercent: userBooks.progressPercent
      })
      .from(userBooks)
      .where(eq(userBooks.id, created.id))

    expect(storedWishlist).toEqual({
      libraryState: 'wishlisted',
      rating: null,
      note: 'keep this',
      readingStatus: 'unread',
      currentPage: null,
      progressPercent: null
    })

    const wishlistPage = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.getLibrary('user-1', { page: 1, pageSize: 10, libraryState: 'wishlisted' })
    ))
    expect(wishlistPage.items.map(item => item.id)).toEqual([created.id])

    const converted = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.updateLibraryState(created.id, 'user-1', 'owned')
    ))
    expect(converted).toMatchObject({
      id: created.id,
      libraryState: 'owned',
      tags: ['Maybe']
    })

    const [stored] = await db
      .select({
        libraryState: userBooks.libraryState,
        rating: userBooks.rating,
        note: userBooks.note
      })
      .from(userBooks)
      .where(eq(userBooks.id, created.id))

    expect(stored).toEqual({
      libraryState: 'owned',
      rating: null,
      note: 'keep this'
    })
  })

  it('clears physical-only metadata when moving an owned book to the wishlist', async () => {
    const created = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.createManualBook('user-1', {
        title: 'Owned Metadata Book',
        authors: ['Ada Lovelace'],
        isbn: null,
        coverPath: null,
        publishDate: null,
        publisher: null,
        numberOfPages: null,
        rating: 5,
        note: 'keep note',
        libraryState: 'owned',
        readingStatus: 'reading',
        currentPage: 44,
        progressPercent: 50,
        tags: []
      })
    ))

    await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.updateLibraryState(created.id, 'user-1', 'wishlisted')
    ))

    const [stored] = await db
      .select({
        libraryState: userBooks.libraryState,
        rating: userBooks.rating,
        note: userBooks.note,
        readingStatus: userBooks.readingStatus,
        currentPage: userBooks.currentPage,
        progressPercent: userBooks.progressPercent
      })
      .from(userBooks)
      .where(eq(userBooks.id, created.id))

    expect(stored).toEqual({
      libraryState: 'wishlisted',
      rating: null,
      note: 'keep note',
      readingStatus: 'unread',
      currentPage: null,
      progressPercent: null
    })
  })

  it('rejects moving an actively loaned book to the wishlist', async () => {
    const created = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.createManualBook('user-1', {
        title: 'Loaned Book',
        authors: ['Ada Lovelace'],
        isbn: null,
        coverPath: null,
        publishDate: null,
        publisher: null,
        numberOfPages: null,
        rating: null,
        note: null,
        libraryState: 'owned',
        readingStatus: 'unread',
        currentPage: null,
        progressPercent: null,
        tags: []
      })
    ))
    const now = new Date('2026-06-26T11:00:00.000Z')
    await db.insert(loans).values({
      id: 'loan-active',
      ownerUserId: 'user-1',
      userBookId: created.id,
      borrowerDisplayName: 'Grace',
      status: 'active',
      loanedAt: now,
      snapshotBookTitle: 'Loaned Book',
      snapshotBookAuthor: 'Ada Lovelace',
      snapshotOwnerName: 'Reader',
      createdAt: now,
      updatedAt: now
    })

    const result = await runRepository(db, Effect.either(Effect.flatMap(BookRepository, repository =>
      repository.updateLibraryState(created.id, 'user-1', 'wishlisted')
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(ActiveLoanRemovalError)
    }
    const [stored] = await db
      .select({ libraryState: userBooks.libraryState })
      .from(userBooks)
      .where(eq(userBooks.id, created.id))
    expect(stored?.libraryState).toBe('owned')
  })

  it('enforces one active user book row per user and book', async () => {
    const now = new Date('2026-06-26T12:00:00.000Z')
    await db.insert(books).values({
      id: 'book-unique',
      title: 'Unique Book',
      source: 'manual',
      createdByUserId: 'user-1',
      createdAt: now
    })
    await db.insert(userBooks).values({
      id: 'ub-active',
      userId: 'user-1',
      bookId: 'book-unique',
      addedAt: now
    })

    await expect(db.insert(userBooks).values({
      id: 'ub-active-duplicate',
      userId: 'user-1',
      bookId: 'book-unique',
      addedAt: now
    })).rejects.toThrow(/user_books_active_user_book_unique|UNIQUE/i)

    await expect(db.insert(userBooks).values({
      id: 'ub-removed-history',
      userId: 'user-1',
      bookId: 'book-unique',
      addedAt: now,
      removedAt: now
    })).resolves.toBeDefined()
  })
})

async function applyMigrations(database: D1Database) {
  for (const migration of [
    initialMigration,
    termsMigration,
    locationRestrictMigration,
    libraryStateMigration,
    libraryIndexesMigration,
    activeUserBookUniqueMigration,
    previouslyOwnedMigration
  ]) {
    for (const statement of migration.split('--> statement-breakpoint')) {
      const migrationStatement = statement.trim()
      if (migrationStatement) {
        await database.prepare(migrationStatement).run()
      }
    }
  }
}

function runRepository<A, E>(
  database: D1Db,
  effect: Effect.Effect<A, E, BookRepository | DbService>
) {
  const typedDatabase = database as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(BookRepositoryLive),
    Effect.provide(Layer.succeed(DbService, {
      db: typedDatabase,
      executeAtomic: buildStatements => typedDatabase.batch(buildStatements(typedDatabase))
    }))
  ))
}

async function seedUser(database: D1Db) {
  const now = new Date('2026-06-26T10:00:00.000Z')
  await database.insert(user).values({
    id: 'user-1',
    name: 'Reader',
    email: 'reader@example.com',
    emailVerified: true,
    role: 'user',
    banned: false,
    createdAt: now,
    updatedAt: now
  })
}
