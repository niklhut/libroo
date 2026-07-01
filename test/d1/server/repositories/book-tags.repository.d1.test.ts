/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:workers'
import { Effect, Either, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { asc, eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'
import locationRestrictMigration from '../../../../server/db/migrations/sqlite/0002_prevent_location_delete_cascade.sql?raw'
import libraryStateMigration from '../../../../server/db/migrations/sqlite/0003_add_library_state.sql?raw'
import { books, bookSystemTags, tags, user, userBooks, userBookTags } from '../../../../server/db/schema'
import { BookNotFoundError, BookRepository, BookRepositoryLive } from '../../../../server/repositories/book.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type D1Db = ReturnType<typeof drizzle>

let db: D1Db

describe('BookRepository tag mutations on D1', () => {
  beforeAll(async () => {
    db = drizzle(env.DB)
    await applyMigrations(env.DB)
  })

  beforeEach(async () => {
    for (const table of [
      'user_book_tags',
      'book_system_tags',
      'tags',
      'user_books',
      'books',
      'user'
    ]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    await seedBase(db)
  })

  it('batch updates by deleting, promoting, and creating tags in one D1 batch', async () => {
    await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.batchUpdateTags('ub-1', 'user-1', ['tag-delete'], ['tag-system'], ['Fresh Tag', 'fresh tag'])
    ))

    await expect(userTagNames(db, 'ub-1')).resolves.toEqual(['Fresh Tag', 'System'])
    await expect(selectTagNames(db)).resolves.toEqual(['Delete Me', 'Fresh Tag', 'Other', 'System'])
  })

  it('rejects batch updates for books not owned by the user', async () => {
    const result = await runRepository(db, Effect.either(Effect.flatMap(BookRepository, repository =>
      repository.batchUpdateTags('ub-1', 'user-2', ['tag-delete'], [], [])
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(BookNotFoundError)
    }
    await expect(userTagNames(db, 'ub-1')).resolves.toEqual(['Delete Me'])
  })

  it('rejects promotion of a tag that is not a system tag for the book', async () => {
    const result = await runRepository(db, Effect.either(Effect.flatMap(BookRepository, repository =>
      repository.batchUpdateTags('ub-1', 'user-1', [], ['tag-other'], [])
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(BookNotFoundError)
    }
    await expect(userTagNames(db, 'ub-1')).resolves.toEqual(['Delete Me'])
  })

  it('garbage collects a tag only when it is fully orphaned', async () => {
    await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.deleteTag('ub-1', 'user-1', 'tag-delete')
    ))

    await expect(selectTagNames(db)).resolves.toEqual(['Other', 'System'])
  })

  it('retains a deleted user tag when another reference remains', async () => {
    await db.insert(userBookTags).values({
      id: 'ubt-other-ref',
      userBookId: 'ub-2',
      tagId: 'tag-delete',
      createdAt: new Date('2026-06-26T10:00:00.000Z'),
      updatedAt: new Date('2026-06-26T10:00:00.000Z')
    })

    await runRepository(db, Effect.flatMap(BookRepository, repository =>
      repository.deleteTag('ub-1', 'user-1', 'tag-delete')
    ))

    await expect(selectTagNames(db)).resolves.toEqual(['Delete Me', 'Other', 'System'])
  })
})

async function applyMigrations(database: D1Database) {
  for (const migration of [initialMigration, termsMigration, locationRestrictMigration, libraryStateMigration]) {
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

async function seedBase(database: D1Db) {
  const now = new Date('2026-06-26T10:00:00.000Z')
  await database.insert(user).values([
    { id: 'user-1', name: 'Reader', email: 'reader@example.com', emailVerified: true, role: 'user', banned: false, createdAt: now, updatedAt: now },
    { id: 'user-2', name: 'Other', email: 'other@example.com', emailVerified: true, role: 'user', banned: false, createdAt: now, updatedAt: now }
  ])
  await database.insert(books).values([
    { id: 'book-1', title: 'Tagged Book', source: 'manual', createdByUserId: 'user-1', createdAt: now },
    { id: 'book-2', title: 'Other Book', source: 'manual', createdByUserId: 'user-2', createdAt: now }
  ])
  await database.insert(userBooks).values([
    { id: 'ub-1', userId: 'user-1', bookId: 'book-1', addedAt: now },
    { id: 'ub-2', userId: 'user-2', bookId: 'book-2', addedAt: now }
  ])
  await database.insert(tags).values([
    { id: 'tag-delete', name: 'Delete Me', normalizedName: 'delete me', createdAt: now, updatedAt: now },
    { id: 'tag-system', name: 'System', normalizedName: 'system', createdAt: now, updatedAt: now },
    { id: 'tag-other', name: 'Other', normalizedName: 'other', createdAt: now, updatedAt: now }
  ])
  await database.insert(bookSystemTags).values({
    bookId: 'book-1',
    tagId: 'tag-system',
    createdAt: now,
    updatedAt: now
  })
  await database.insert(userBookTags).values({
    id: 'ubt-delete',
    userBookId: 'ub-1',
    tagId: 'tag-delete',
    createdAt: now,
    updatedAt: now
  })
}

async function userTagNames(database: D1Db, userBookId: string) {
  const rows = await database
    .select({ name: tags.name })
    .from(userBookTags)
    .innerJoin(tags, eq(userBookTags.tagId, tags.id))
    .where(eq(userBookTags.userBookId, userBookId))
    .orderBy(asc(tags.name))
  return rows.map(row => row.name)
}

async function selectTagNames(database: D1Db) {
  const rows = await database
    .select({ name: tags.name })
    .from(tags)
    .orderBy(asc(tags.name))
  return rows.map(row => row.name)
}
