import { BookEditRepository, BookEditRepositoryLive } from '../../../../server/repositories/book-edit.repository'
import { bookEditSchema, manualBookCreateSchema } from '../../../../shared/utils/schemas'
/// <reference types="@cloudflare/vitest-plugin" />

import { env } from 'cloudflare:workers'
import { Effect, Result, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { count, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'
import locationRestrictMigration from '../../../../server/db/migrations/sqlite/0002_prevent_location_delete_cascade.sql?raw'
import libraryStateMigration from '../../../../server/db/migrations/sqlite/0003_add_library_state.sql?raw'
import previouslyOwnedMigration from '../../../../server/db/migrations/sqlite/0006_huge_tiger_shark.sql?raw'
import inviteEmailMigration from '../../../../server/db/migrations/sqlite/0008_brave_saracen.sql?raw'
import loanNoteMigration from '../../../../server/db/migrations/sqlite/0010_owner_private_loan_note.sql?raw'
import borrowerSuggestionsMigration from '../../../../server/db/migrations/sqlite/0011_borrower_suggestions.sql?raw'
import enrichmentMigration from '../../../../server/db/migrations/sqlite/0012_imported_book_enrichment.sql?raw'
import authFactorsMigration from '../../../../server/db/migrations/sqlite/0013_auth-two-factor-passkeys.sql?raw'
import recentAuthMigration from '../../../../server/db/migrations/sqlite/0014_recent-auth.sql?raw'
import durableOpenLibraryPayloadMigration from '../../../../server/db/migrations/sqlite/0019_durable_open_library_payload.sql?raw'
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

  it('edits one entry without changing shared metadata, private fields, or its stable ID', async () => {
    const original = await runRepository(db, Effect.flatMap(BookRepository, repo => repo.createManualBook('user-1', {
      ...manualBookCreateSchema.parse({ title: 'Original', authors: ['Original Author'], isbn: '9780441172719', tags: ['Favourite'], note: 'Keep note', rating: 4, readingStatus: 'reading', currentPage: 12 }), coverPath: 'covers/manual/user-1/original.webp'
    })))
    await db.update(books).set({ source: 'open_library' }).where(eq(books.id, original.bookId))
    const now = new Date()
    await db.insert(user).values({ id: 'user-2', name: 'Other', email: 'other@example.com', createdAt: now, updatedAt: now })
    await db.insert(userBooks).values({ id: 'other-copy', userId: 'user-2', bookId: original.bookId, addedAt: now })
    await db.insert(loans).values({
      id: 'edit-loan', ownerUserId: 'user-1', userBookId: original.id, borrowerDisplayName: 'Borrower',
      status: 'active', loanedAt: now, dueAt: now, snapshotBookTitle: 'Original', snapshotBookAuthor: 'Original Author',
      snapshotOwnerName: 'Reader', snapshotCoverPath: 'covers/manual/user-1/loan-only.webp', createdAt: now, updatedAt: now
    })
    const input = bookEditSchema.parse({ expectedBookId: original.bookId, title: 'Corrected title', authors: ['New Author', 'Second Author'], isbn: '9780441172719', publisher: 'New Publisher', numberOfPages: 300 })
    expect(await runEdit(db, 'user-1', original.id, input)).toBe(true)
    const [edited] = await db.select().from(userBooks).where(eq(userBooks.id, original.id))
    expect(edited).toMatchObject({ id: original.id, rating: 4, note: 'Keep note', currentPage: 12 })
    expect(edited!.bookId).not.toBe(original.bookId)
    const [other] = await db.select().from(userBooks).where(eq(userBooks.id, 'other-copy'))
    expect(other!.bookId).toBe(original.bookId)
    const [oldBook] = await db.select().from(books).where(eq(books.id, original.bookId))
    expect(oldBook!.title).toBe('Original')
    const details = await runRepository(db, Effect.flatMap(BookRepository, repo => repo.getUserBookWithDetails(original.id, 'user-1')))
    expect(details).toMatchObject({ title: 'Corrected title', authors: [{ name: 'New Author' }, { name: 'Second Author' }], publishers: 'New Publisher', numberOfPages: 300, coverPath: null })
    expect(details.userTags.map(tag => tag.name)).toContain('Favourite')
    expect(details.activeLoan?.id).toBe('edit-loan')
    const database = db as unknown as DbServiceInterface['db']
    const coverReferenced = await Effect.runPromise(Effect.flatMap(BookEditRepository, repo =>
      repo.isCoverReferenced('covers/manual/user-1/loan-only.webp')
    ).pipe(Effect.provide(BookEditRepositoryLive), Effect.provide(Layer.succeed(DbService, { db: database, executeAtomic: build => database.batch(build(database)) }))))
    expect(coverReferenced).toBe(true)
    const [replacement] = await db.select().from(books).where(eq(books.id, edited!.bookId))
    expect(replacement).toMatchObject({ source: 'manual', entrySource: 'manual_entry', createdByUserId: 'user-1', openLibraryMetadata: null })
  })

  it('fences concurrent saves and rejects another user without inserting book copies', async () => {
    const original = await runRepository(db, Effect.flatMap(BookRepository, repo => repo.createManualBook('user-1', {
      ...manualBookCreateSchema.parse({ title: 'Original', authors: ['Author'], isbn: null }), coverPath: null
    })))
    const input = bookEditSchema.parse({ expectedBookId: original.bookId, title: 'Edited', authors: ['Author'], isbn: null })
    expect(await runEdit(db, 'not-owner', original.id, input)).toBe(false)
    const results = await Promise.all([runEdit(db, 'user-1', original.id, input), runEdit(db, 'user-1', original.id, input)])
    expect(results.filter(Boolean)).toHaveLength(1)
    const [total] = await db.select({ count: count() }).from(books)
    expect(total!.count).toBe(1)
  })

  it('creates a manual book through D1 batch without opening a transaction', async () => {
    const result = await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.createManualBook('user-1', {
        title: 'Manual Cloudflare Book',
        authors: ['Ada Lovelace', 'Ada Lovelace', 'Grace Hopper'],
        isbn: '0-441-17271-7',
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
        author: 'Ada Lovelace, Grace Hopper',
        isbn: '9780441172719'
      }
    })
    expect([...result.tags].sort()).toEqual(['Computing', 'History'])

    await expect(db.select().from(books).where(eq(books.id, result.bookId))).resolves.toHaveLength(1)
    await expect(db.select().from(userBooks).where(eq(userBooks.id, result.id))).resolves.toHaveLength(1)
    await expect(db.select().from(bookAuthors).where(eq(bookAuthors.bookId, result.bookId))).resolves.toHaveLength(2)
    await expect(db.select().from(userBookTags).where(eq(userBookTags.userBookId, result.id))).resolves.toHaveLength(2)
  })

  it('rejects manual cover paths outside the signed-in user namespace', async () => {
    const result = await runRepository(db, Effect.result(Effect.flatMap(BookRepository, repository =>
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

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(BookCreateError)
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

    const result = await runRepository(db, Effect.result(Effect.flatMap(BookRepository, repository =>
      repository.updateLibraryState(created.id, 'user-1', 'wishlisted')
    )))

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ActiveLoanRemovalError)
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
    previouslyOwnedMigration,
    inviteEmailMigration,
    loanNoteMigration,
    borrowerSuggestionsMigration,
    enrichmentMigration,
    authFactorsMigration,
    recentAuthMigration,
    durableOpenLibraryPayloadMigration
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

function runEdit(database: D1Db, userId: string, userBookId: string, input: import('../../../../shared/utils/schemas').BookEditSchema) {
  const db = database as unknown as DbServiceInterface['db']
  return Effect.runPromise(Effect.flatMap(BookEditRepository, repo => repo.replace(userId, userBookId, input, null)).pipe(
    Effect.provide(BookEditRepositoryLive),
    Effect.provide(Layer.succeed(DbService, { db, executeAtomic: build => db.batch(build(db)) }))
  ))
}
