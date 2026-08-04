/// <reference types="@cloudflare/vitest-pool-workers" />

import { env } from 'cloudflare:workers'
import { Effect, Layer } from 'effect'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
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
import { bookEnrichmentJobs, books, user, userBooks } from '../../../../server/db/schema'
import {
  BookEnrichmentRepository,
  BookEnrichmentRepositoryLive
} from '../../../../server/repositories/book-enrichment.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type D1Db = ReturnType<typeof drizzle>

let db: D1Db

describe('BookEnrichmentRepository on D1', () => {
  beforeAll(async () => {
    db = drizzle(env.DB)
    await applyMigrations(env.DB)
  })

  beforeEach(async () => {
    for (const table of [
      'book_enrichment_jobs',
      'book_enrichment_locks',
      'user_books',
      'books',
      'user'
    ]) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    await seedPendingJob(db)
  })

  it('lets only one concurrent worker claim a job', async () => {
    const now = new Date('2026-07-26T10:00:00.000Z')
    const leaseExpiresAt = new Date(now.getTime() + 60_000)
    const claim = () => runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.claimJobs({ limit: 10, now, leaseExpiresAt })
    ))

    const [first, second] = await Promise.all([claim(), claim()])
    expect([...first, ...second]).toHaveLength(1)
    expect([...first, ...second][0]).toMatchObject({
      bookId: 'book-1',
      isbn: '9780441172719',
      attempts: 1
    })
  })

  it('prevents workers from holding the same ISBN lock until its lease expires', async () => {
    const now = new Date('2026-07-26T10:00:00.000Z')
    const firstLease = new Date(now.getTime() + 60_000)
    const first = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.acquireIsbnLocks(['9780441172719'], 'claim-a', firstLease, now)
    ))
    const second = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.acquireIsbnLocks(['9780441172719'], 'claim-b', firstLease, now)
    ))
    const afterExpiry = new Date(firstLease.getTime() + 1)
    const third = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.acquireIsbnLocks(
        ['9780441172719'],
        'claim-c',
        new Date(afterExpiry.getTime() + 60_000),
        afterExpiry
      )
    ))

    expect([...first]).toEqual(['9780441172719'])
    expect([...second]).toEqual([])
    expect([...third]).toEqual(['9780441172719'])
  })

  it('does not apply stale results after the imported ISBN changes', async () => {
    const now = new Date('2026-07-26T10:00:00.000Z')
    const [job] = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.claimJobs({
        limit: 1,
        now,
        leaseExpiresAt: new Date(now.getTime() + 60_000)
      })
    ))
    await db.update(books).set({ isbn: '9780141439518' }).where(eq(books.id, 'book-1'))

    const applied = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.applyMetadata(job!, {
        coverPath: 'covers/9780441172719.webp',
        description: 'Stale description',
        openLibraryKey: '/books/OL1M',
        workKey: '/works/OL1W'
      })
    ))

    expect(applied).toBe(false)
    await expect(db.select({
      coverPath: books.coverPath,
      description: books.description,
      metadataProviderIsbn: books.metadataProviderIsbn
    }).from(books).where(eq(books.id, 'book-1'))).resolves.toEqual([{
      coverPath: null,
      description: null,
      metadataProviderIsbn: null
    }])
  })

  it('cancels work when the user no longer actively owns the imported book', async () => {
    await db.update(userBooks)
      .set({ removedAt: new Date('2026-07-26T09:00:00.000Z') })
      .where(eq(userBooks.id, 'ub-1'))

    const cancelled = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.cancelIneligibleJobs(new Date('2026-07-26T10:00:00.000Z'))
    ))

    expect(cancelled).toBe(1)
    await expect(db.select({ status: bookEnrichmentJobs.status }).from(bookEnrichmentJobs))
      .resolves.toEqual([{ status: 'cancelled' }])
  })

  it('returns only the requested user-owned card updates', async () => {
    const updates = await runRepository(Effect.flatMap(BookEnrichmentRepository, repository =>
      repository.getUpdatesForUserBooks('user-1', ['ub-1', 'another-users-book'])
    ))

    expect(updates).toEqual([{
      userBookId: 'ub-1',
      coverPath: null,
      status: 'pending'
    }])
  })
})

async function applyMigrations(database: D1Database) {
  for (const migration of [
    initialMigration,
    termsMigration,
    locationRestrictMigration,
    libraryStateMigration,
    previouslyOwnedMigration,
    inviteEmailMigration,
    loanNoteMigration,
    borrowerSuggestionsMigration,
    enrichmentMigration,
    authFactorsMigration,
    recentAuthMigration
  ]) {
    for (const statement of migration.split('--> statement-breakpoint')) {
      const migrationStatement = statement.trim()
      if (migrationStatement) await database.prepare(migrationStatement).run()
    }
  }
}

async function seedPendingJob(database: D1Db) {
  const now = new Date('2026-07-26T09:00:00.000Z')
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
  await database.insert(books).values({
    id: 'book-1',
    isbn: '9780441172719',
    title: 'Dune',
    source: 'manual',
    entrySource: 'csv_import',
    createdByUserId: 'user-1',
    createdAt: now
  })
  await database.insert(userBooks).values({
    id: 'ub-1',
    userId: 'user-1',
    bookId: 'book-1',
    libraryState: 'owned',
    addedAt: now
  })
  await database.insert(bookEnrichmentJobs).values({
    id: 'job-1',
    batchId: 'batch-1',
    userId: 'user-1',
    bookId: 'book-1',
    isbn: '9780441172719',
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    createdAt: now,
    updatedAt: now
  })
}

function runRepository<A, E>(
  effect: Effect.Effect<A, E, BookEnrichmentRepository | DbService>
) {
  const typedDatabase = db as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(BookEnrichmentRepositoryLive),
    Effect.provide(Layer.succeed(DbService, {
      db: typedDatabase,
      executeAtomic: buildStatements => typedDatabase.batch(buildStatements(typedDatabase))
    }))
  ))
}
