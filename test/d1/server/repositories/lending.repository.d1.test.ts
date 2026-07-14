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
import inviteEmailMigration from '../../../../server/db/migrations/sqlite/0008_brave_saracen.sql?raw'
import { authors, bookAuthors, books, loans, user, userBooks } from '../../../../server/db/schema'
import { BookNotOwnedError } from '../../../../server/repositories/book.repository'
import {
  LendingRepository,
  LendingRepositoryLive,
  LoanNotFoundError
} from '../../../../server/repositories/lending.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type D1Db = ReturnType<typeof drizzle>

const baseTime = new Date('2026-06-24T10:00:00.000Z')
let db: D1Db

describe('LendingRepository transitions on D1', () => {
  beforeAll(async () => {
    db = drizzle(env.DB)
    await applyMigrations(env.DB)
  })

  beforeEach(async () => {
    for (const table of ['loans', 'user_books', 'book_authors', 'books', 'authors', 'user']) {
      await env.DB.prepare(`DELETE FROM ${table}`).run()
    }
    await seedBase(db)
  })

  it('returns an active loan and clears its accept token', async () => {
    await seedUserBook(db, 'ub-active', 'owner-1', 'book-1')
    await seedLoan(db, { id: 'loan-active', userBookId: 'ub-active', ownerUserId: 'owner-1', status: 'active', acceptTokenHash: 'token-active' })

    const returned = await runRepository(db, Effect.flatMap(LendingRepository, repository =>
      repository.returnLoan('loan-active', 'owner-1')
    ))
    const stored = await getLoan(db, 'loan-active')

    expect(returned.status).toBe('returned')
    expect(returned.returnedAt).toBeInstanceOf(Date)
    expect(stored.status).toBe('returned')
    expect(stored.acceptTokenHash).toBeNull()
  })

  it.each(['wishlisted', 'previously_owned'] as const)('rejects loan creation for %s books', async (libraryState) => {
    const userBookId = `ub-${libraryState}`
    await seedUserBook(db, userBookId, 'owner-1', 'book-1', libraryState)

    const result = await runRepository(db, Effect.either(Effect.flatMap(LendingRepository, repository =>
      repository.createLoan({
        userBookId,
        ownerUserId: 'owner-1',
        borrowerDisplayName: 'Borrower',
        borrowerEmail: null,
        dueAt: null,
        acceptTokenHash: `token-${libraryState}`
      })
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(BookNotOwnedError)
      expect(result.left.libraryState).toBe(libraryState)
    }
  })

  it('rejects cancelLoan for an accepted loan', async () => {
    await seedUserBook(db, 'ub-accepted', 'owner-1', 'book-1')
    await seedLoan(db, {
      id: 'loan-accepted',
      userBookId: 'ub-accepted',
      ownerUserId: 'owner-1',
      borrowerUserId: 'borrower-1',
      acceptedAt: new Date('2026-06-25T10:00:00.000Z'),
      acceptTokenHash: null
    })

    const result = await runRepository(db, Effect.either(Effect.flatMap(LendingRepository, repository =>
      repository.cancelLoan('loan-accepted', 'owner-1')
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LoanNotFoundError)
    }
  })

  it.each([
    ['returnLoan', (loanId: string) => Effect.flatMap(LendingRepository, repository => repository.returnLoan(loanId, 'owner-2'))],
    ['cancelLoan', (loanId: string) => Effect.flatMap(LendingRepository, repository => repository.cancelLoan(loanId, 'owner-2'))]
  ] as const)('returns LoanNotFoundError for wrong-owner %s calls', async (_label, effectForLoan) => {
    await seedUserBook(db, `ub-${_label}`, 'owner-1', 'book-1')
    await seedLoan(db, { id: `loan-${_label}`, userBookId: `ub-${_label}`, ownerUserId: 'owner-1', status: 'active' })

    const result = await runRepository(db, Effect.either(effectForLoan(`loan-${_label}`)))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LoanNotFoundError)
    }
  })
})

async function applyMigrations(database: D1Database) {
  for (const migration of [initialMigration, termsMigration, locationRestrictMigration, libraryStateMigration, previouslyOwnedMigration, inviteEmailMigration]) {
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
  effect: Effect.Effect<A, E, LendingRepository | DbService>
) {
  const typedDatabase = database as unknown as DbServiceInterface['db']
  return Effect.runPromise(effect.pipe(
    Effect.provide(LendingRepositoryLive),
    Effect.provide(Layer.succeed(DbService, {
      db: typedDatabase,
      executeAtomic: buildStatements => typedDatabase.batch(buildStatements(typedDatabase))
    }))
  ))
}

async function seedBase(database: D1Db) {
  await database.insert(user).values([
    { id: 'owner-1', name: 'Owner One', email: 'owner1@example.com', emailVerified: true, role: 'user', banned: false, createdAt: baseTime, updatedAt: baseTime },
    { id: 'owner-2', name: 'Owner Two', email: 'owner2@example.com', emailVerified: true, role: 'user', banned: false, createdAt: baseTime, updatedAt: baseTime },
    { id: 'borrower-1', name: 'Borrower One', email: 'borrower1@example.com', emailVerified: true, role: 'user', banned: false, createdAt: baseTime, updatedAt: baseTime }
  ])
  await database.insert(books).values({
    id: 'book-1',
    title: 'Book One',
    source: 'manual',
    createdByUserId: 'owner-1',
    createdAt: baseTime
  })
  await database.insert(authors).values({
    id: 'author-1',
    name: 'Author One',
    normalizedName: 'author one',
    createdAt: baseTime,
    updatedAt: baseTime
  })
  await database.insert(bookAuthors).values({
    bookId: 'book-1',
    authorId: 'author-1',
    sortOrder: 0,
    createdAt: baseTime
  })
}

async function seedUserBook(database: D1Db, id: string, userId: string, bookId: string, libraryState: 'owned' | 'wishlisted' | 'previously_owned' = 'owned') {
  await database.insert(userBooks).values({
    id,
    userId,
    bookId,
    libraryState,
    addedAt: baseTime
  })
}

async function seedLoan(database: D1Db, input: Partial<typeof loans.$inferInsert> & {
  id: string
  userBookId: string
  ownerUserId: string
}) {
  await database.insert(loans).values({
    id: input.id,
    ownerUserId: input.ownerUserId,
    userBookId: input.userBookId,
    borrowerUserId: input.borrowerUserId ?? null,
    borrowerDisplayName: input.borrowerDisplayName ?? 'Borrower',
    borrowerEmail: input.borrowerEmail ?? 'borrower@example.com',
    status: input.status ?? 'active',
    loanedAt: input.loanedAt ?? baseTime,
    dueAt: input.dueAt ?? null,
    returnedAt: input.returnedAt ?? null,
    canceledAt: input.canceledAt ?? null,
    snapshotBookTitle: input.snapshotBookTitle ?? 'Book One',
    snapshotBookAuthor: input.snapshotBookAuthor ?? 'Author One',
    snapshotCoverPath: input.snapshotCoverPath ?? null,
    snapshotOwnerName: input.snapshotOwnerName ?? 'Owner One',
    acceptTokenHash: input.acceptTokenHash === undefined ? `token-${input.id}` : input.acceptTokenHash,
    acceptedAt: input.acceptedAt ?? null,
    createdAt: input.createdAt ?? baseTime,
    updatedAt: input.updatedAt ?? baseTime
  })
}

async function getLoan(database: D1Db, id: string) {
  const rows = await database.select().from(loans).where(eq(loans.id, id)).limit(1)
  const loan = rows[0]
  if (!loan) throw new Error(`Missing loan ${id}`)
  return loan
}
