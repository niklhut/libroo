import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Effect, Either, Layer } from 'effect'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { authors, bookAuthors, books, loans, user, userBooks } from '../../../../server/db/schema'
import {
  LendingRepository,
  LendingRepositoryLive,
  LoanNotFoundError
} from '../../../../server/repositories/lending.repository'
import { DbService, type DbServiceInterface } from '../../../../server/services/db.service'

type Database = ReturnType<typeof drizzle>
type AtomicMode = 'd1-batch' | 'selfhost-transaction'
type LoanStatus = typeof loans.$inferInsert.status

const baseTime = new Date('2026-06-24T10:00:00.000Z')

describe.each<AtomicMode>(['d1-batch', 'selfhost-transaction'])('LendingRepository (%s)', (mode) => {
  let db: Database
  let dbDir: string
  let client: ReturnType<typeof createClient> | null = null

  beforeEach(async () => {
    dbDir = await mkdtemp(join(tmpdir(), 'libroo-lending-repository-'))
    client = createClient({ url: `file:${join(dbDir, 'test.db')}` })
    db = drizzle(client)
    await client.execute('PRAGMA foreign_keys = ON')

    for (const migrationFile of ['0000_initial_beta.sql', '0001_add_terms_acceptance.sql', '0002_prevent_location_delete_cascade.sql']) {
      const migrationPath = fileURLToPath(
        new URL(`../../../../server/db/migrations/sqlite/${migrationFile}`, import.meta.url)
      )
      const migration = await readFile(migrationPath, 'utf8')
      for (const statement of migration.split('--> statement-breakpoint')) {
        const migrationStatement = statement.trim()
        if (migrationStatement) {
          await client.execute(migrationStatement)
        }
      }
    }

    await seedUsers(db)
    await seedBooksAndAuthors(db)
  })

  afterEach(async () => {
    client?.close()
    client = null
    await rm(dbDir, { recursive: true, force: true })
  })

  it('returns an active loan and clears its accept token', async () => {
    await seedUserBook(db, 'ub-1', 'owner-1', 'book-1')
    await seedLoan(db, { id: 'loan-active', userBookId: 'ub-1', ownerUserId: 'owner-1', status: 'active', acceptTokenHash: 'token-1' })

    const returned = await runRepository(db, mode, Effect.flatMap(LendingRepository, repository =>
      repository.returnLoan('loan-active', 'owner-1')
    ))
    const stored = await getLoan(db, 'loan-active')

    expect(returned.status).toBe('returned')
    expect(returned.returnedAt).toBeInstanceOf(Date)
    expect(returned.canceledAt).toBeNull()
    expect(stored.status).toBe('returned')
    expect(stored.returnedAt).toBeInstanceOf(Date)
    expect(stored.acceptTokenHash).toBeNull()
  })

  it.each([
    ['already returned', 'returned'],
    ['already canceled', 'canceled']
  ] as const)('rejects returnLoan for %s loans', async (_label, status) => {
    await seedUserBook(db, `ub-${status}`, 'owner-1', 'book-1')
    await seedLoan(db, {
      id: `loan-${status}`,
      userBookId: `ub-${status}`,
      ownerUserId: 'owner-1',
      status,
      returnedAt: status === 'returned' ? new Date('2026-06-25T10:00:00.000Z') : null,
      canceledAt: status === 'canceled' ? new Date('2026-06-25T10:00:00.000Z') : null
    })

    const result = await runRepository(db, mode, Effect.either(Effect.flatMap(LendingRepository, repository =>
      repository.returnLoan(`loan-${status}`, 'owner-1')
    )))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LoanNotFoundError)
    }
  })

  it('cancels an active unaccepted loan', async () => {
    await seedUserBook(db, 'ub-cancel', 'owner-1', 'book-1')
    await seedLoan(db, { id: 'loan-cancel', userBookId: 'ub-cancel', ownerUserId: 'owner-1', status: 'active', acceptTokenHash: 'token-cancel' })

    const canceled = await runRepository(db, mode, Effect.flatMap(LendingRepository, repository =>
      repository.cancelLoan('loan-cancel', 'owner-1')
    ))
    const stored = await getLoan(db, 'loan-cancel')

    expect(canceled.status).toBe('canceled')
    expect(canceled.canceledAt).toBeInstanceOf(Date)
    expect(stored.status).toBe('canceled')
    expect(stored.canceledAt).toBeInstanceOf(Date)
    expect(stored.acceptTokenHash).toBeNull()
  })

  it.each([
    ['accepted active loan', { status: 'active' as const, acceptedAt: new Date('2026-06-25T10:00:00.000Z'), borrowerUserId: 'borrower-1' }],
    ['already returned loan', { status: 'returned' as const, returnedAt: new Date('2026-06-25T10:00:00.000Z') }],
    ['already canceled loan', { status: 'canceled' as const, canceledAt: new Date('2026-06-25T10:00:00.000Z') }]
  ])('rejects cancelLoan for an %s', async (_label, loanInput) => {
    const id = `loan-${String(_label).replaceAll(' ', '-')}`
    const userBookId = `ub-${String(_label).replaceAll(' ', '-')}`
    await seedUserBook(db, userBookId, 'owner-1', 'book-1')
    await seedLoan(db, { id, userBookId, ownerUserId: 'owner-1', ...loanInput })

    const result = await runRepository(db, mode, Effect.either(Effect.flatMap(LendingRepository, repository =>
      repository.cancelLoan(id, 'owner-1')
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
    await seedUserBook(db, `ub-wrong-${_label}`, 'owner-1', 'book-1')
    await seedLoan(db, { id: `loan-wrong-${_label}`, userBookId: `ub-wrong-${_label}`, ownerUserId: 'owner-1', status: 'active' })

    const result = await runRepository(db, mode, Effect.either(effectForLoan(`loan-wrong-${_label}`)))

    expect(Either.isLeft(result)).toBe(true)
    if (Either.isLeft(result)) {
      expect(result.left).toBeInstanceOf(LoanNotFoundError)
    }
  })

  it('lists only loans for the requested owner across all statuses', async () => {
    await seedUserBook(db, 'ub-owner-active', 'owner-1', 'book-1')
    await seedUserBook(db, 'ub-owner-returned', 'owner-1', 'book-1')
    await seedUserBook(db, 'ub-owner-canceled', 'owner-1', 'book-1')
    await seedUserBook(db, 'ub-other-active', 'owner-2', 'book-2')
    await seedLoan(db, { id: 'loan-owner-active', userBookId: 'ub-owner-active', ownerUserId: 'owner-1', status: 'active', loanedAt: new Date('2026-06-24T13:00:00.000Z') })
    await seedLoan(db, { id: 'loan-owner-returned', userBookId: 'ub-owner-returned', ownerUserId: 'owner-1', status: 'returned', loanedAt: new Date('2026-06-24T12:00:00.000Z'), returnedAt: new Date('2026-06-25T12:00:00.000Z') })
    await seedLoan(db, { id: 'loan-owner-canceled', userBookId: 'ub-owner-canceled', ownerUserId: 'owner-1', status: 'canceled', loanedAt: new Date('2026-06-24T11:00:00.000Z'), canceledAt: new Date('2026-06-25T11:00:00.000Z') })
    await seedLoan(db, { id: 'loan-other-active', userBookId: 'ub-other-active', ownerUserId: 'owner-2', bookId: 'book-2', status: 'active', loanedAt: new Date('2026-06-24T14:00:00.000Z') })

    const ownerLoans = await runRepository(db, mode, Effect.flatMap(LendingRepository, repository =>
      repository.listOwnerLoans('owner-1')
    ))

    expect(ownerLoans.map(loan => [loan.id, loan.status])).toEqual([
      ['loan-owner-active', 'active'],
      ['loan-owner-returned', 'returned'],
      ['loan-owner-canceled', 'canceled']
    ])
  })

  it('lists only accepted borrowed books for the borrower', async () => {
    await seedUserBook(db, 'ub-accepted', 'owner-1', 'book-1')
    await seedUserBook(db, 'ub-unaccepted', 'owner-1', 'book-1')
    await seedUserBook(db, 'ub-other-borrower', 'owner-1', 'book-1')
    await seedLoan(db, { id: 'loan-accepted', userBookId: 'ub-accepted', ownerUserId: 'owner-1', borrowerUserId: 'borrower-1', acceptedAt: new Date('2026-06-24T12:00:00.000Z'), acceptTokenHash: null, loanedAt: new Date('2026-06-24T12:00:00.000Z') })
    await seedLoan(db, { id: 'loan-unaccepted', userBookId: 'ub-unaccepted', ownerUserId: 'owner-1', borrowerUserId: 'borrower-1', acceptedAt: null, loanedAt: new Date('2026-06-24T13:00:00.000Z') })
    await seedLoan(db, { id: 'loan-other-borrower', userBookId: 'ub-other-borrower', ownerUserId: 'owner-1', borrowerUserId: 'borrower-2', acceptedAt: new Date('2026-06-24T14:00:00.000Z'), acceptTokenHash: null, loanedAt: new Date('2026-06-24T14:00:00.000Z') })

    const borrowed = await runRepository(db, mode, Effect.flatMap(LendingRepository, repository =>
      repository.listBorrowedBooks('borrower-1')
    ))

    expect(borrowed.map(book => book.id)).toEqual(['loan-accepted'])
    expect(borrowed[0]).toMatchObject({ title: 'Book One', author: 'Author One', ownerName: 'Owner One', ownerRemoved: false })
  })

  it('keeps accepted borrowed records visible after owner-side book removal', async () => {
    await seedUserBook(db, 'ub-removed', 'owner-1', 'book-1', new Date('2026-06-25T10:00:00.000Z'))
    await seedLoan(db, { id: 'loan-removed-book', userBookId: 'ub-removed', ownerUserId: 'owner-1', borrowerUserId: 'borrower-1', acceptedAt: new Date('2026-06-24T12:00:00.000Z'), acceptTokenHash: null })

    const borrowed = await runRepository(db, mode, Effect.flatMap(LendingRepository, repository =>
      repository.listBorrowedBooks('borrower-1')
    ))

    expect(borrowed).toHaveLength(1)
    expect(borrowed[0]).toMatchObject({ id: 'loan-removed-book', ownerRemoved: true })
  })
})

function repositoryEffect<A, E>(
  db: Database,
  mode: AtomicMode,
  effect: Effect.Effect<A, E, LendingRepository | DbService>
) {
  const database = db as unknown as DbServiceInterface['db']
  const executeAtomic: DbServiceInterface['executeAtomic'] = mode === 'd1-batch'
    ? buildStatements => database.batch(buildStatements(database))
    : buildStatements => database.transaction(async (tx) => {
      const results: unknown[] = []
      for (const statement of buildStatements(tx as unknown as DbServiceInterface['db'])) {
        results.push(await statement)
      }
      return results
    })

  return effect.pipe(
    Effect.provide(LendingRepositoryLive),
    Effect.provide(Layer.succeed(DbService, { db: database, executeAtomic }))
  )
}

function runRepository<A, E>(
  db: Database,
  mode: AtomicMode,
  effect: Effect.Effect<A, E, LendingRepository | DbService>
) {
  return Effect.runPromise(repositoryEffect(db, mode, effect))
}

async function seedUsers(database: Database) {
  await database.insert(user).values([
    { id: 'owner-1', name: 'Owner One', email: 'owner1@example.com', emailVerified: true, role: 'user', banned: false, createdAt: baseTime, updatedAt: baseTime },
    { id: 'owner-2', name: 'Owner Two', email: 'owner2@example.com', emailVerified: true, role: 'user', banned: false, createdAt: baseTime, updatedAt: baseTime },
    { id: 'borrower-1', name: 'Borrower One', email: 'borrower1@example.com', emailVerified: true, role: 'user', banned: false, createdAt: baseTime, updatedAt: baseTime },
    { id: 'borrower-2', name: 'Borrower Two', email: 'borrower2@example.com', emailVerified: true, role: 'user', banned: false, createdAt: baseTime, updatedAt: baseTime }
  ])
}

async function seedBooksAndAuthors(database: Database) {
  await database.insert(books).values([
    { id: 'book-1', title: 'Book One', source: 'manual', createdByUserId: 'owner-1', coverPath: '/covers/book-1.webp', createdAt: baseTime },
    { id: 'book-2', title: 'Book Two', source: 'manual', createdByUserId: 'owner-2', coverPath: null, createdAt: baseTime }
  ])
  await database.insert(authors).values([
    { id: 'author-1', name: 'Author One', normalizedName: 'author one', createdAt: baseTime, updatedAt: baseTime },
    { id: 'author-2', name: 'Author Two', normalizedName: 'author two', createdAt: baseTime, updatedAt: baseTime }
  ])
  await database.insert(bookAuthors).values([
    { bookId: 'book-1', authorId: 'author-1', sortOrder: 0, createdAt: baseTime },
    { bookId: 'book-2', authorId: 'author-2', sortOrder: 0, createdAt: baseTime }
  ])
}

async function seedUserBook(
  database: Database,
  id: string,
  userId: string,
  bookId: string,
  removedAt: Date | null = null
) {
  await database.insert(userBooks).values({
    id,
    userId,
    bookId,
    addedAt: baseTime,
    removedAt
  })
}

async function seedLoan(database: Database, input: Partial<typeof loans.$inferInsert> & {
  id: string
  userBookId: string
  ownerUserId: string
  bookId?: string
  status?: LoanStatus
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
    snapshotBookTitle: input.snapshotBookTitle ?? (input.bookId === 'book-2' ? 'Book Two' : 'Book One'),
    snapshotBookAuthor: input.snapshotBookAuthor ?? (input.bookId === 'book-2' ? 'Author Two' : 'Author One'),
    snapshotCoverPath: input.snapshotCoverPath ?? null,
    snapshotOwnerName: input.snapshotOwnerName ?? (input.ownerUserId === 'owner-2' ? 'Owner Two' : 'Owner One'),
    acceptTokenHash: input.acceptTokenHash === undefined ? `token-${input.id}` : input.acceptTokenHash,
    acceptedAt: input.acceptedAt ?? null,
    createdAt: input.createdAt ?? baseTime,
    updatedAt: input.updatedAt ?? baseTime
  })
}

async function getLoan(database: Database, id: string) {
  const rows = await database.select().from(loans).where(eq(loans.id, id)).limit(1)
  const loan = rows[0]
  if (!loan) throw new Error(`Missing loan ${id}`)
  return loan
}
