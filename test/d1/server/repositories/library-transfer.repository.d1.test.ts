/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:workers'
import { Effect, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { asc, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'
import locationRestrictMigration from '../../../../server/db/migrations/sqlite/0002_prevent_location_delete_cascade.sql?raw'
import libraryStateMigration from '../../../../server/db/migrations/sqlite/0003_add_library_state.sql?raw'
import previouslyOwnedMigration from '../../../../server/db/migrations/sqlite/0006_huge_tiger_shark.sql?raw'
import inviteEmailMigration from '../../../../server/db/migrations/sqlite/0008_brave_saracen.sql?raw'
import loanNoteMigration from '../../../../server/db/migrations/sqlite/0010_owner_private_loan_note.sql?raw'
import { authors, bookAuthors, books, loans, locations, tags, user, userBooks, userBookTags } from '../../../../server/db/schema'
import { LibraryTransferRepository, LibraryTransferRepositoryLive } from '../../../../server/repositories/library-transfer.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'
import type { LibraryImportBookInput, LibraryImportConflictStrategy } from '../../../../shared/types/library-transfer'

type D1Db = ReturnType<typeof drizzle>

let db: D1Db

describe('LibraryTransferRepository.importRecords on D1', () => {
  beforeAll(async () => {
    db = drizzle(env.DB)
    await applyMigrations(env.DB)
  })

  beforeEach(async () => {
    for (const table of [
      'loans',
      'user_book_tags',
      'book_authors',
      'tags',
      'user_books',
      'locations',
      'books',
      'authors',
      'user'
    ]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    await seedUser(db)
  })

  it('reuses new author, tag, and location dimensions across records', async () => {
    const result = await importRecords([
      importRecord({ title: 'First Shelf Book', authors: ['Ada Lovelace'], tags: ['Computing'], locationPath: 'Shelf - Row' }),
      importRecord({ title: 'Second Shelf Book', authors: ['Ada Lovelace'], tags: ['Computing'], locationPath: 'shelf - Bin' })
    ], 'csv')

    expect(result).toMatchObject({ created: 2, updated: 0, skipped: 0, failed: [] })
    await expect(db.select().from(authors)).resolves.toHaveLength(1)
    await expect(db.select().from(tags)).resolves.toHaveLength(1)
    await expect(db.select().from(locations)).resolves.toHaveLength(3)
    await expect(locationPaths(db)).resolves.toEqual(['Shelf', 'Shelf - Bin', 'Shelf - Row'])

    const authorLinks = await db.select().from(bookAuthors)
    const tagLinks = await db.select().from(userBookTags)
    expect(new Set(authorLinks.map(row => row.authorId))).toHaveProperty('size', 1)
    expect(new Set(tagLinks.map(row => row.tagId))).toHaveProperty('size', 1)
  })

  it('skips detected duplicates with the existing strategy', async () => {
    await seedExistingBook(db)

    const result = await importRecords([
      importRecord({ title: 'Existing Book', authors: ['Ada Lovelace'], isbn: '9781111111111', note: 'csv note' })
    ], 'existing')

    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1, failed: [] })
    const rows = await db.select({ note: userBooks.note }).from(userBooks).where(eq(userBooks.id, 'ub-existing'))
    expect(rows).toEqual([{ note: 'original note' }])
  })

  it('updates detected duplicates with the csv strategy', async () => {
    await seedExistingBook(db)

    const result = await importRecords([
      importRecord({
        title: 'Existing Book Updated',
        authors: ['Grace Hopper'],
        isbn: '9781111111111',
        tags: ['Updated'],
        locationPath: 'Desk',
        note: 'csv note',
        rating: 5
      })
    ], 'csv')

    expect(result).toMatchObject({ created: 0, updated: 1, skipped: 0, failed: [] })
    const bookRows = await db.select({ title: books.title }).from(books).where(eq(books.id, 'book-existing'))
    const userBookRows = await db.select({ note: userBooks.note, rating: userBooks.rating }).from(userBooks).where(eq(userBooks.id, 'ub-existing'))
    const tagRows = await db.select({ name: tags.name }).from(tags).orderBy(asc(tags.name))
    expect(bookRows).toEqual([{ title: 'Existing Book Updated' }])
    expect(userBookRows).toEqual([{ note: 'csv note', rating: 5 }])
    expect(tagRows).toEqual([{ name: 'Updated' }])
  })

  it('sanitizes physical-only fields for wishlisted imports', async () => {
    const result = await importRecords([
      importRecord({
        title: 'Wishlist CSV Book',
        authors: ['Ada Lovelace'],
        locationPath: 'Desk',
        libraryState: 'wishlisted',
        readingStatus: 'reading',
        currentPage: 12,
        progressPercent: 30,
        rating: 5,
        note: 'keep note'
      })
    ], 'csv')

    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0, failed: [] })
    await expect(db.select().from(locations)).resolves.toHaveLength(0)
    const rows = await db
      .select({
        libraryState: userBooks.libraryState,
        locationId: userBooks.locationId,
        rating: userBooks.rating,
        note: userBooks.note,
        readingStatus: userBooks.readingStatus,
        currentPage: userBooks.currentPage,
        progressPercent: userBooks.progressPercent
      })
      .from(userBooks)

    expect(rows).toEqual([{
      libraryState: 'wishlisted',
      locationId: null,
      rating: null,
      note: 'keep note',
      readingStatus: 'unread',
      currentPage: null,
      progressPercent: null
    }])
  })

  it('rejects wishlisted updates for existing books with active loans', async () => {
    await seedExistingBook(db)
    const now = new Date('2026-06-26T11:00:00.000Z')
    await db.insert(loans).values({
      id: 'loan-active',
      ownerUserId: 'user-1',
      userBookId: 'ub-existing',
      borrowerDisplayName: 'Borrower',
      status: 'active',
      loanedAt: now,
      snapshotBookTitle: 'Existing Book',
      snapshotBookAuthor: 'Ada Lovelace',
      snapshotOwnerName: 'Reader',
      createdAt: now,
      updatedAt: now
    })

    const result = await importRecords([
      importRecord({
        title: 'Existing Book',
        authors: ['Ada Lovelace'],
        isbn: '9781111111111',
        libraryState: 'wishlisted'
      })
    ], 'csv')

    expect(result).toMatchObject({
      created: 0,
      updated: 0,
      skipped: 0,
      failed: [{
        row: 2,
        title: 'Existing Book',
        reason: 'Cannot move a book with an active loan to the wishlist'
      }]
    })
    const rows = await db
      .select({ libraryState: userBooks.libraryState })
      .from(userBooks)
      .where(eq(userBooks.id, 'ub-existing'))
    expect(rows).toEqual([{ libraryState: 'owned' }])
  })

  it('does not fall back to title and author matching when an ISBN is provided', async () => {
    await seedExistingBook(db)

    const result = await importRecords([
      importRecord({ title: 'Existing Book', authors: ['Ada Lovelace'], isbn: '9782222222222', note: 'new isbn row' })
    ], 'csv')

    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0, failed: [] })
    await expect(db.select().from(userBooks)).resolves.toHaveLength(2)
  })

  it('preserves shared Open Library authors when reusing an ISBN match', async () => {
    const now = new Date('2026-06-26T10:00:00.000Z')
    await db.insert(authors).values({ id: 'author-open-library', name: 'Catalog Author', normalizedName: 'catalog author', createdAt: now, updatedAt: now })
    await db.insert(books).values({
      id: 'open-library-book',
      isbn: '9783333333333',
      title: 'Shared Catalog Book',
      source: 'open_library',
      createdAt: now
    })
    await db.insert(bookAuthors).values({ bookId: 'open-library-book', authorId: 'author-open-library', sortOrder: 0, createdAt: now })

    const result = await importRecords([
      importRecord({ title: 'Shared Catalog Book', authors: ['CSV Author'], isbn: '9783333333333' })
    ], 'csv')

    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 0, failed: [] })
    const authorRows = await db
      .select({ name: authors.name })
      .from(bookAuthors)
      .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
      .where(eq(bookAuthors.bookId, 'open-library-book'))
    expect(authorRows).toEqual([{ name: 'Catalog Author' }])
  })
})

async function applyMigrations(database: D1Database) {
  for (const migration of [initialMigration, termsMigration, locationRestrictMigration, libraryStateMigration, previouslyOwnedMigration, inviteEmailMigration, loanNoteMigration]) {
    for (const statement of migration.split('--> statement-breakpoint')) {
      const migrationStatement = statement.trim()
      if (migrationStatement) {
        await database.prepare(migrationStatement).run()
      }
    }
  }
}

function importRecords(records: LibraryImportBookInput[], strategy: LibraryImportConflictStrategy) {
  return runRepository(db, Effect.flatMap(LibraryTransferRepository, repository =>
    repository.importRecords('user-1', records, strategy)
  ))
}

function runRepository<A, E>(
  database: D1Db,
  effect: Effect.Effect<A, E, LibraryTransferRepository | DbService>
) {
  const typedDatabase = database as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(LibraryTransferRepositoryLive),
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

async function seedExistingBook(database: D1Db) {
  const now = new Date('2026-06-26T10:00:00.000Z')
  await database.insert(authors).values({ id: 'author-existing', name: 'Ada Lovelace', normalizedName: 'ada lovelace', createdAt: now, updatedAt: now })
  await database.insert(books).values({
    id: 'book-existing',
    isbn: '9781111111111',
    title: 'Existing Book',
    source: 'manual',
    createdByUserId: 'user-1',
    createdAt: now
  })
  await database.insert(bookAuthors).values({ bookId: 'book-existing', authorId: 'author-existing', sortOrder: 0, createdAt: now })
  await database.insert(userBooks).values({
    id: 'ub-existing',
    userId: 'user-1',
    bookId: 'book-existing',
    note: 'original note',
    rating: 2,
    addedAt: now
  })
}

async function locationPaths(database: D1Db) {
  const rows = await database
    .select({ path: locations.path })
    .from(locations)
    .orderBy(asc(locations.path))
  return rows.map(row => row.path)
}

function importRecord(overrides: Partial<LibraryImportBookInput>): LibraryImportBookInput {
  return {
    title: 'Imported Book',
    authors: ['Ada Lovelace'],
    isbn: null,
    tags: [],
    locationPath: null,
    libraryState: 'owned',
    readingStatus: 'unread',
    currentPage: null,
    progressPercent: null,
    rating: null,
    note: null,
    addedAt: null,
    ...overrides
  }
}
