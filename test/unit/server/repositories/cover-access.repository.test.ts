import initialMigration from '../../../../server/db/migrations/sqlite/0000_initial_beta.sql?raw'
import termsAcceptanceMigration from '../../../../server/db/migrations/sqlite/0001_add_terms_acceptance.sql?raw'
import { Effect, Layer } from 'effect'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { books, loans, user, userBooks } from '../../../../server/db/schema'
import { BookRepository, BookRepositoryLive } from '../../../../server/repositories/book.repository'
import { LendingRepository, LendingRepositoryLive } from '../../../../server/repositories/lending.repository'
import { DbService } from '../../../../server/services/db.service'

type Database = ReturnType<typeof drizzle>
let testDb: Database

describe('cover access repository helpers', () => {
  let db: Database
  let client: ReturnType<typeof createClient> | null = null

  beforeEach(async () => {
    client = createClient({ url: ':memory:' })
    db = drizzle(client)
    testDb = db
    await client.execute('PRAGMA foreign_keys = ON')

    for (const migration of [initialMigration, termsAcceptanceMigration]) {
      for (const statement of migration.split('--> statement-breakpoint')) {
        const sql = statement.trim()
        if (sql) {
          await client.execute(sql)
        }
      }
    }

    await seedCoverAccessScenario(db)
  })

  afterEach(async () => {
    client?.close()
    client = null
  })

  it('checks manual cover ownership against active user book rows', async () => {
    await expect(runBookRepository(Effect.flatMap(BookRepository, repository =>
      repository.userOwnsManualCover('owner-1', 'covers/manual/owner-1/book.webp')
    ))).resolves.toBe(true)

    await expect(runBookRepository(Effect.flatMap(BookRepository, repository =>
      repository.userOwnsManualCover('owner-1', 'covers/manual/owner-1/removed.webp')
    ))).resolves.toBe(false)

    await expect(runBookRepository(Effect.flatMap(BookRepository, repository =>
      repository.userOwnsManualCover('borrower-1', 'covers/manual/owner-1/book.webp')
    ))).resolves.toBe(false)
  })

  it('checks loan cover access for owners and active accepted borrowers only', async () => {
    await expect(runLendingRepository(Effect.flatMap(LendingRepository, repository =>
      repository.userHasLoanCoverAccess('owner-1', 'covers/manual/owner-1/returned.webp')
    ))).resolves.toBe(true)

    await expect(runLendingRepository(Effect.flatMap(LendingRepository, repository =>
      repository.userHasLoanCoverAccess('borrower-1', 'covers/manual/owner-1/book.webp')
    ))).resolves.toBe(true)

    await expect(runLendingRepository(Effect.flatMap(LendingRepository, repository =>
      repository.userHasLoanCoverAccess('borrower-1', 'covers/manual/owner-1/pending.webp')
    ))).resolves.toBe(false)

    await expect(runLendingRepository(Effect.flatMap(LendingRepository, repository =>
      repository.userHasLoanCoverAccess('borrower-1', 'covers/manual/owner-1/returned.webp')
    ))).resolves.toBe(false)

    await expect(runLendingRepository(Effect.flatMap(LendingRepository, repository =>
      repository.userHasLoanCoverAccess('unrelated-1', 'covers/manual/owner-1/book.webp')
    ))).resolves.toBe(false)
  })
})

async function seedCoverAccessScenario(db: ReturnType<typeof drizzle>) {
  const now = new Date('2026-06-26T10:00:00.000Z')
  await db.insert(user).values([
    { id: 'owner-1', name: 'Owner', email: 'owner@example.com', emailVerified: true, createdAt: now, updatedAt: now },
    { id: 'borrower-1', name: 'Borrower', email: 'borrower@example.com', emailVerified: true, createdAt: now, updatedAt: now },
    { id: 'unrelated-1', name: 'Unrelated', email: 'unrelated@example.com', emailVerified: true, createdAt: now, updatedAt: now }
  ])

  await db.insert(books).values([
    { id: 'book-owned', isbn: null, title: 'Owned', source: 'manual', coverPath: 'covers/manual/owner-1/book.webp', createdAt: now },
    { id: 'book-removed', isbn: null, title: 'Removed', source: 'manual', coverPath: 'covers/manual/owner-1/removed.webp', createdAt: now },
    { id: 'book-pending', isbn: null, title: 'Pending', source: 'manual', coverPath: 'covers/manual/owner-1/pending.webp', createdAt: now },
    { id: 'book-returned', isbn: null, title: 'Returned', source: 'manual', coverPath: 'covers/manual/owner-1/returned.webp', createdAt: now }
  ])

  await db.insert(userBooks).values([
    { id: 'user-book-owned', userId: 'owner-1', bookId: 'book-owned', addedAt: now, removedAt: null },
    { id: 'user-book-removed', userId: 'owner-1', bookId: 'book-removed', addedAt: now, removedAt: now },
    { id: 'user-book-pending', userId: 'owner-1', bookId: 'book-pending', addedAt: now, removedAt: null },
    { id: 'user-book-returned', userId: 'owner-1', bookId: 'book-returned', addedAt: now, removedAt: null }
  ])

  await db.insert(loans).values([
    {
      id: 'loan-active-accepted',
      ownerUserId: 'owner-1',
      userBookId: 'user-book-owned',
      borrowerUserId: 'borrower-1',
      borrowerDisplayName: 'Borrower',
      status: 'active',
      loanedAt: now,
      snapshotBookTitle: 'Owned',
      snapshotBookAuthor: 'Author',
      snapshotCoverPath: 'covers/manual/owner-1/book.webp',
      snapshotOwnerName: 'Owner',
      acceptedAt: now,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'loan-active-pending',
      ownerUserId: 'owner-1',
      userBookId: 'user-book-pending',
      borrowerUserId: 'borrower-1',
      borrowerDisplayName: 'Borrower',
      status: 'active',
      loanedAt: now,
      snapshotBookTitle: 'Pending',
      snapshotBookAuthor: 'Author',
      snapshotCoverPath: 'covers/manual/owner-1/pending.webp',
      snapshotOwnerName: 'Owner',
      acceptedAt: null,
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'loan-returned',
      ownerUserId: 'owner-1',
      userBookId: 'user-book-returned',
      borrowerUserId: 'borrower-1',
      borrowerDisplayName: 'Borrower',
      status: 'returned',
      loanedAt: now,
      returnedAt: now,
      snapshotBookTitle: 'Returned',
      snapshotBookAuthor: 'Author',
      snapshotCoverPath: 'covers/manual/owner-1/returned.webp',
      snapshotOwnerName: 'Owner',
      acceptedAt: now,
      createdAt: now,
      updatedAt: now
    }
  ])
}

function runBookRepository<A, E>(effect: Effect.Effect<A, E, BookRepository | DbService>) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(BookRepositoryLive),
    Effect.provide(dbLayer())
  ))
}

function runLendingRepository<A, E>(effect: Effect.Effect<A, E, LendingRepository | DbService>) {
  return Effect.runPromise(effect.pipe(
    Effect.provide(LendingRepositoryLive),
    Effect.provide(dbLayer())
  ))
}

function dbLayer() {
  return Layer.succeed(DbService, {
    db: testDb as never,
    executeAtomic: async () => {
      throw new Error('executeAtomic is not used by cover access repository tests')
    }
  })
}
