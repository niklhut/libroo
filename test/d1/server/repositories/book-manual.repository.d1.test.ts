/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:workers'
import { Effect, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'
import locationRestrictMigration from '../../../../server/db/migrations/sqlite/0002_prevent_location_delete_cascade.sql?raw'
import { bookAuthors, books, user, userBooks, userBookTags } from '../../../../server/db/schema'
import { BookRepository, BookRepositoryLive } from '../../../../server/repositories/book.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type D1Db = ReturnType<typeof drizzle>

let db: D1Db

describe('BookRepository.createManualBook on D1', () => {
  beforeAll(async () => {
    db = drizzle(env.DB)
    await applyMigrations(env.DB)
  })

  beforeEach(async () => {
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
})

async function applyMigrations(database: D1Database) {
  for (const migration of [initialMigration, termsMigration, locationRestrictMigration]) {
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
